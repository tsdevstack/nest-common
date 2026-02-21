import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import { IS_PUBLIC_KEY } from './public.decorator';
import { KongHeaders, KongUser } from './auth-user.interface';
import { SecretsService } from '../secrets/secrets.service';

// Type for the request object (Express/Fastify compatible)
interface RequestWithHeaders {
  url?: string;
  path?: string;
  headers: Record<string, string | string[] | undefined>;
  user?: KongUser;
  service?: string;
}

/**
 * Guard that validates requests came through Kong gateway and extracts user data.
 *
 * This guard implements the tsdevstack authentication architecture where:
 * 1. Kong validates JWT signatures using JWKS endpoint
 * 2. Kong forwards ALL JWT claims as JSON in `X-Userinfo` header (kong-oidc-v3)
 * 3. Kong adds `X-Kong-Trust` header to prove requests came through gateway
 * 4. Services validate Kong trust header for defense-in-depth security
 * 5. Services trust Kong headers (network isolation + trust header prevents spoofing)
 * 6. Services never validate JWT tokens themselves
 *
 * ## How It Works
 *
 * ### Kong Trust Header Verification
 * - Kong adds `X-Kong-Trust` header with KONG_TRUST_TOKEN value to ALL requests
 * - Guard verifies this header before processing authentication
 * - Direct service-to-service calls with `x-api-key` bypass this check
 * - Prevents direct access to backend services bypassing Kong
 *
 * ### JWT Authentication (User Requests)
 * - Kong validates JWT and sets `X-Consumer-ID` (from JWT `sub` claim)
 * - Kong forwards all JWT claims as JSON in `X-Userinfo` header
 * - Guard parses the JSON and extracts ALL claims into `req.user` object
 * - Claims preserve their original types (arrays, numbers, booleans, strings)
 * - Falls back to legacy `X-JWT-Claim-*` headers for backward compatibility
 *
 * ### API Key Authentication (Service-to-Service)
 * - Kong validates API key and sets `X-Consumer-Username` (service name)
 * - Guard sets `req.service` to the service name
 * - No user object is created
 *
 * ### Public Endpoints
 * - Routes marked with `@Public()` decorator skip user authentication
 * - But still require Kong trust header (unless direct service-to-service)
 *
 * @example Basic usage with JWT
 * ```typescript
 * @Controller('offers')
 * export class OffersController {
 *   @Post()
 *   @UseGuards(AuthGuard)
 *   create(@Request() req: AuthenticatedRequest) {
 *     const { id, email, roles } = req.user;
 *     // Access any custom claims dynamically
 *     const tenantId = req.user.tenantId;
 *   }
 * }
 * ```
 *
 * @example Public endpoint
 * ```typescript
 * @Get()
 * @Public()
 * list() {
 *   // No user authentication required, but must come through Kong
 * }
 * ```
 *
 * @example Service-to-service with API key
 * ```typescript
 * @Get('internal')
 * @UseGuards(AuthGuard)
 * internal(@Request() req: AuthenticatedRequest) {
 *   const serviceName = req.service; // e.g., "bff-service"
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

  /**
   * Validates the request came through Kong and extracts authentication data.
   *
   * @param context - Execution context
   * @returns true if authentication is valid or endpoint is public
   * @throws UnauthorizedException if Kong headers are missing
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const apiKey = request.headers['x-api-key'] as string | undefined;
    const kongTrustHeader = request.headers['x-kong-trust'] as string | undefined;

    // Determine if request came through Kong (has trust header)
    const cameFromKong = !!kongTrustHeader;

    if (cameFromKong) {
      // Request has Kong trust header - verify it's valid
      await this.verifyKongTrustHeader(request);
      // If API key is present, Kong already validated it (partner API)
      // No need to re-validate against service's API_KEY
    } else if (apiKey) {
      // Direct service-to-service call (no Kong) - validate API key
      await this.validateServiceApiKey(request, apiKey);
    }

    // Check if endpoint is marked as @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Check for Kong headers (from gateway or service-to-service forwarding)
    const consumerId = request.headers[KongHeaders.CONSUMER_ID];
    const consumerUsername = request.headers[KongHeaders.CONSUMER_USERNAME];
    const credentialIdentifier = request.headers[KongHeaders.CREDENTIAL_IDENTIFIER];
    const userinfo = request.headers[KongHeaders.USERINFO];

    // If we have Kong headers, extract user/service info
    const hasKongHeaders = consumerId || consumerUsername || credentialIdentifier || userinfo;

    if (hasKongHeaders) {
      // JWT authentication: Build user from headers
      if (consumerId || credentialIdentifier || userinfo) {
        request.user = this.extractUserFromHeaders(request.headers);
      }
      // Kong API key authentication (partner APIs): Set service name
      else if (consumerUsername) {
        request.service = consumerUsername;
      }
      return true;
    }

    // Partner API through Kong: has trust header + API key, but X-Consumer-Username removed
    if (cameFromKong && apiKey) {
      request.service = 'partner'; // Generic partner identifier
      return true;
    }

    // Direct service-to-service (validated above)
    if (apiKey) {
      return true;
    }

    // No authentication provided at all
    throw new UnauthorizedException('No authentication provided');
  }

  /**
   * Extracts user object from Kong headers.
   *
   * kong-oidc-v3 forwards JWT claims as base64-encoded JSON in the `X-Userinfo` header.
   * Falls back to legacy `X-JWT-Claim-*` headers for backward compatibility.
   *
   * @param headers - HTTP headers from the request
   * @returns User object with id and all dynamic claims
   *
   * @example
   * ```typescript
   * // Input headers (kong-oidc-v3):
   * {
   *   'x-credential-identifier': 'user-123',
   *   'x-userinfo': 'eyJzdWIiOiJ1c2VyLTEyMyIsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSIsInJvbGVzIjpbIlVTRVIiLCJBRE1JTiJdLCJ0ZW5hbnRJZCI6InRlbmFudC00NTYifQ=='
   * }
   *
   * // Output user object:
   * {
   *   id: 'user-123',
   *   email: 'user@example.com',
   *   roles: ['USER', 'ADMIN'],
   *   tenantId: 'tenant-456'
   * }
   * ```
   */
  private extractUserFromHeaders(headers: Record<string, string>): KongUser {
    // Primary: Extract claims from X-Userinfo JSON (kong-oidc-v3)
    // Note: kong-oidc-v3 base64-encodes the userinfo JSON
    const userinfo = headers[KongHeaders.USERINFO];
    if (userinfo) {
      try {
        // Decode base64 to get JSON string
        const decodedUserinfo = Buffer.from(userinfo, 'base64').toString('utf-8');
        const claims = JSON.parse(decodedUserinfo);

        // Build user object with 'sub' claim as 'id'
        const user: KongUser = { id: claims.sub };

        // Copy all other claims
        Object.keys(claims).forEach((key) => {
          if (key !== 'sub') {
            user[key] = claims[key];
          }
        });

        return user;
      } catch (error) {
        // Log error but continue to fallback
        console.error('Failed to parse X-Userinfo header:', error);
      }
    }

    // Fallback: Get user ID from consumer headers
    const userId = headers[KongHeaders.CONSUMER_ID] || headers[KongHeaders.CREDENTIAL_IDENTIFIER];
    const user: KongUser = { id: userId };

    // Fallback: Extract claims from X-JWT-Claim-* headers (legacy)
    Object.keys(headers).forEach((key) => {
      if (key.startsWith(KongHeaders.JWT_CLAIM_PREFIX)) {
        // Extract claim name (remove prefix)
        const claimName = key.replace(KongHeaders.JWT_CLAIM_PREFIX, '');

        // Convert to camelCase (tenant-id → tenantId)
        const camelCase = this.toCamelCase(claimName);

        // Parse value intelligently
        user[camelCase] = this.parseValue(headers[key]);
      }
    });

    return user;
  }

  /**
   * Converts kebab-case to camelCase.
   *
   * @param str - Kebab-case string (e.g., "tenant-id")
   * @returns CamelCase string (e.g., "tenantId")
   *
   * @example
   * ```typescript
   * toCamelCase('tenant-id')      // 'tenantId'
   * toCamelCase('is-verified')    // 'isVerified'
   * toCamelCase('email')          // 'email'
   * ```
   */
  private toCamelCase(str: string): string {
    return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  /**
   * Parses header value to appropriate JavaScript type.
   *
   * Kong forwards all JWT claims as strings. This method intelligently
   * parses them back to their original types:
   * - Arrays: "USER,ADMIN" → ["USER", "ADMIN"]
   * - Numbers: "123" → 123
   * - Booleans: "true" → true, "false" → false
   * - Strings: everything else
   *
   * @param value - String value from header
   * @returns Parsed value in appropriate type
   *
   * @example
   * ```typescript
   * parseValue('USER,ADMIN')     // ['USER', 'ADMIN']
   * parseValue('123')            // 123
   * parseValue('true')           // true
   * parseValue('false')          // false
   * parseValue('john@example.com') // 'john@example.com'
   * ```
   */
  private parseValue(value: string): string | string[] | number | boolean {
    // Parse arrays (comma-separated values)
    if (value.includes(',')) {
      return value.split(',').map((v) => v.trim());
    }

    // Parse numbers (only if entire string is digits)
    if (/^\d+$/.test(value)) {
      return parseInt(value, 10);
    }

    // Parse booleans
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Return as string
    return value;
  }

  /**
   * Verifies that the request came through Kong gateway by validating the trust header.
   * This is a defense-in-depth measure to prevent direct access to backend services.
   *
   * @param request - HTTP request object
   * @throws UnauthorizedException if Kong trust header is missing or invalid
   *
   * @example
   * ```typescript
   * // Kong adds this header to all requests:
   * // Request headers: { 'x-kong-trust': 'KONG_TRUST_TOKEN_VALUE' }
   * // Service validates it matches the KONG_TRUST_TOKEN from secrets
   * ```
   */
  private async verifyKongTrustHeader(request: RequestWithHeaders): Promise<void> {
    // Allow infrastructure endpoints to be accessed without Kong trust header
    // These are accessed directly by Prometheus/K8s, not through Kong gateway
    const path = request.url || request.path;
    if (path) {
      // .well-known: needed by Kong's OIDC plugin for discovery and JWKS
      // /health, /metrics: infrastructure endpoints for Prometheus/K8s probes
      if (
        path.includes('/.well-known/') ||
        path === '/health' ||
        path.startsWith('/health/') ||
        path === '/metrics'
      ) {
        this.logger.debug(`Skipping Kong trust check for infrastructure endpoint: ${path}`);
        return;
      }
    }

    const kongTrustHeader = request.headers['x-kong-trust'] as string | undefined;

    if (!kongTrustHeader) {
      this.logger.warn('Missing Kong trust header - request did not come through gateway');
      throw new UnauthorizedException('Unauthorized request');
    }

    // Get expected Kong trust token from secrets
    const expectedToken = await this.secrets.get('KONG_TRUST_TOKEN');

    if (!expectedToken) {
      this.logger.error('KONG_TRUST_TOKEN not configured in secrets');
      throw new UnauthorizedException('Authentication configuration error');
    }

    // Timing-safe comparison to prevent timing attacks
    const provided = Buffer.from(kongTrustHeader);
    const expected = Buffer.from(expectedToken);

    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      this.logger.warn('Invalid Kong trust header - possible bypass attempt');
      throw new UnauthorizedException('Unauthorized request');
    }

    this.logger.debug('Kong trust header verified');
  }

  /**
   * Validates direct service-to-service API key authentication.
   * Used when services call each other directly (bypassing Kong).
   *
   * @param request - HTTP request object
   * @param apiKey - API key from x-api-key header
   * @returns true if API key is valid
   * @throws UnauthorizedException if API key configuration is missing
   * @throws ForbiddenException if API key is invalid
   *
   * @example
   * ```typescript
   * // Service A calling Service B:
   * // Request headers: { 'x-api-key': 'AUTH_SERVICE_API_KEY_VALUE' }
   * // Service B validates against its own API_KEY from secrets
   * ```
   */
  private async validateServiceApiKey(
    request: RequestWithHeaders,
    apiKey: string,
  ): Promise<boolean> {
    // Structured audit log context
    const auditContext = {
      type: 'service-to-service',
      method: (request as { method?: string }).method || 'UNKNOWN',
      path: request.url || request.path || 'UNKNOWN',
      caller: (request.headers['x-service-name'] as string) || 'unknown',
      // Don't log full API key - use fingerprint for debugging
      keyFingerprint: apiKey.slice(0, 8) + '...',
    };

    // Get this service's own API key from secrets
    const validApiKey = await this.secrets.get('API_KEY');

    if (!validApiKey) {
      this.logger.error('API_KEY not configured in secrets');
      throw new UnauthorizedException('Server API key is not configured');
    }

    // Timing-safe comparison to prevent timing attacks
    const provided = Buffer.from(apiKey);
    const expected = Buffer.from(validApiKey);

    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      this.logger.warn('Invalid service API key attempt', auditContext);
      throw new ForbiddenException('Invalid API key');
    }

    // Valid API key - this is an internal service call
    // Use x-service-name header if provided, otherwise default to 'internal'
    request.service = (request.headers['x-service-name'] as string) || 'internal';
    this.logger.log('Service-to-service request authenticated', auditContext);

    return true;
  }
}