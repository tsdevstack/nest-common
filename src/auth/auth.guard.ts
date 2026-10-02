import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { IS_PARTNER_API_KEY } from './partner-api.decorator';
import { KongHeaders } from './auth-user.interface';
import type {
  AuthType,
  AuthenticatedApiKey,
  KongUser,
} from './auth-user.interface';
import { INTERNAL_SERVICE_NAME, PARTNER_SERVICE_NAME } from './auth.constants';
import { SecretsService } from '../secrets/secrets.service';
import { classifyGatewayIdentity } from './utils/classify-gateway-identity';
import { getRequestPathname } from './utils/get-request-pathname';
import { isInfrastructurePath } from './utils/is-infrastructure-path';
import { readHeader } from './utils/read-header';
import { timingSafeStringEqual } from './utils/timing-safe-string-equal';

/** Request shape the guard reads and populates (Express compatible) */
interface GuardRequest {
  method?: string;
  url?: string;
  path?: string;
  headers: Record<string, string | string[] | undefined>;
  authType?: AuthType;
  user?: KongUser;
  apiKey?: AuthenticatedApiKey;
  service?: string;
  viaGateway?: boolean;
}

/** Result of checking a service `x-api-key` */
type ServiceKeyCheck = 'valid' | 'invalid' | 'unconfigured';

/**
 * Authenticates every request and enforces who may call a handler.
 *
 * ## Trust first
 *
 * Kong adds `X-Kong-Trust` (the `KONG_TRUST_TOKEN` secret) to every request it
 * forwards. Identity headers count only after that token is verified:
 *
 * - Token valid: the caller is classified by the Kong plugin that vouched for
 *   it. `X-Userinfo` (OIDC) gives `authType: 'user'` and `req.user`.
 *   `X-Api-Key-Id` and `X-Api-Key-Consumer` (key plugin) give
 *   `authType: 'apiKey'`, `req.apiKey` and `req.service = 'partner'`.
 * - Token missing: identity headers are ignored. The request is an internal
 *   service call with this service's `API_KEY` (`authType: 'service'`), an
 *   anonymous call to a `@Public()` handler, or 401.
 * - Token present but wrong: 401, except on infrastructure paths
 *   (`/.well-known/`, `/health`, `/metrics`, matched on the path without the
 *   query string), where the token is ignored and identity headers too.
 *
 * A valid token also sets `req.viaGateway = true`, so later guards (for
 * example `RateLimitGuard` reading `X-Real-IP`) can trust gateway-set headers.
 *
 * The consumer headers of Kong's bundled auth plugins (`X-Consumer-*`,
 * `X-Credential-Identifier`) never produce a user or a partner key.
 * `X-Userinfo` together with an API key identity header (`X-Api-Key-Id`,
 * `X-Api-Key-Consumer`) is treated as forged: 401.
 *
 * ## Who may call a handler
 *
 * - `apiKey` on a handler without `@PartnerApi()`: 403.
 * - `@Public()`: anyone (credentials are still classified when present).
 * - `@PartnerApi()`: any authenticated caller (`apiKey`, `user`, `service`).
 * - Otherwise: a `user` or an internal `service`; no credentials gives 401.
 *
 * A service `x-api-key` that does not match `API_KEY` gives 403, except on
 * `@Public()` handlers, where it is ignored.
 *
 * @example
 * ```typescript
 * @Get('profile')
 * profile(@Req() req: AuthenticatedRequest) {
 *   return req.user; // authType === 'user'
 * }
 *
 * @Get('export')
 * @ApiBearerAuth()
 * @PartnerApi()
 * export(@Req() req: AuthenticatedRequest) {
 *   // authType: 'user' via /data/export, 'apiKey' via /api/data/export
 * }
 * ```
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private reflector: Reflector,
    private secrets: SecretsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ===
      true;
    const isPartnerApi =
      this.reflector.getAllAndOverride<boolean>(IS_PARTNER_API_KEY, targets) ===
      true;

    const trusted = await this.verifyKongTrust(request);
    if (trusted) {
      request.viaGateway = true;
    }

    const identity = trusted ? classifyGatewayIdentity(request.headers) : null;

    if (identity?.authType === 'conflict') {
      this.logger.warn(
        'Conflicting identity headers: X-Userinfo together with API key headers - treated as forged',
        { path: getRequestPathname(request) },
      );
      throw new UnauthorizedException('Unauthorized request');
    }

    if (identity?.authType === 'user') {
      request.authType = 'user';
      request.user = identity.user;
    } else if (identity?.authType === 'apiKey') {
      request.authType = 'apiKey';
      request.apiKey = identity.apiKey;
      request.service = PARTNER_SERVICE_NAME;
    } else {
      await this.authenticateService(request, isPublic);
    }

    return this.authorize(request, isPublic, isPartnerApi);
  }

  /**
   * Decides whether the classified caller may use the handler.
   */
  private authorize(
    request: GuardRequest,
    isPublic: boolean,
    isPartnerApi: boolean,
  ): boolean {
    if (request.authType === 'apiKey' && !isPartnerApi) {
      this.logger.warn('API key request on a handler without @PartnerApi()', {
        path: getRequestPathname(request),
        keyId: request.apiKey?.id,
        consumer: request.apiKey?.consumer,
      });
      throw new ForbiddenException('API keys cannot access this endpoint');
    }

    if (isPublic) {
      return true;
    }

    if (request.authType === undefined) {
      throw new UnauthorizedException('No authentication provided');
    }

    // @PartnerApi() handlers accept every authenticated caller; the others
    // accept users and internal services (apiKey was rejected above).
    return true;
  }

  /**
   * Verifies the Kong trust token.
   *
   * @returns true when a valid token is present; false when it is absent or
   *   the path is an infrastructure endpoint
   * @throws UnauthorizedException when the token is present but wrong
   */
  private async verifyKongTrust(request: GuardRequest): Promise<boolean> {
    const provided = readHeader(request.headers, KongHeaders.KONG_TRUST);
    if (provided === undefined) {
      return false;
    }

    const pathname = getRequestPathname(request);
    if (isInfrastructurePath(pathname)) {
      this.logger.debug(
        `Ignoring Kong trust header on infrastructure endpoint: ${pathname}`,
      );
      return false;
    }

    const expected = await this.secrets.get('KONG_TRUST_TOKEN');
    if (!expected) {
      this.logger.error('KONG_TRUST_TOKEN not configured in secrets');
      throw new UnauthorizedException('Authentication configuration error');
    }

    if (!timingSafeStringEqual(provided, expected)) {
      this.logger.warn('Invalid Kong trust header - possible bypass attempt');
      throw new UnauthorizedException('Unauthorized request');
    }

    return true;
  }

  /**
   * Authenticates an internal service call by its `x-api-key`, when present.
   * Sets `authType: 'service'` and `req.service` on success.
   *
   * @throws ForbiddenException for a wrong key on a non-public handler
   * @throws UnauthorizedException when `API_KEY` is not configured on a non-public handler
   */
  private async authenticateService(
    request: GuardRequest,
    isPublic: boolean,
  ): Promise<void> {
    const apiKey = readHeader(request.headers, KongHeaders.API_KEY);
    if (apiKey === undefined) {
      return;
    }

    const caller =
      readHeader(request.headers, KongHeaders.SERVICE_NAME) ||
      INTERNAL_SERVICE_NAME;
    const auditContext = {
      type: 'service-to-service',
      method: request.method || 'UNKNOWN',
      path: getRequestPathname(request) || 'UNKNOWN',
      caller,
    };

    const check = await this.checkServiceApiKey(apiKey);

    if (check === 'valid') {
      request.authType = 'service';
      request.service = caller;
      this.logger.log('Service-to-service request authenticated', auditContext);
      return;
    }

    if (isPublic) {
      // A wrong key does not block a public handler; the caller stays anonymous.
      return;
    }

    if (check === 'unconfigured') {
      throw new UnauthorizedException('Server API key is not configured');
    }

    this.logger.warn('Invalid service API key attempt', auditContext);
    throw new ForbiddenException('Invalid API key');
  }

  /**
   * Compares a provided key with this service's `API_KEY` secret.
   */
  private async checkServiceApiKey(apiKey: string): Promise<ServiceKeyCheck> {
    const validApiKey = await this.secrets.get('API_KEY');
    if (!validApiKey) {
      this.logger.error('API_KEY not configured in secrets');
      return 'unconfigured';
    }
    return timingSafeStringEqual(apiKey, validApiKey) ? 'valid' : 'invalid';
  }
}
