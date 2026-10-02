import { describe, it, expect, beforeEach, rs } from '@rstest/core';
import {
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import { IS_PARTNER_API_KEY } from './partner-api.decorator';
import type { AuthenticatedRequest } from './auth-user.interface';
import type { SecretsService } from '../secrets/secrets.service';

const KONG_TRUST_TOKEN = 'test-kong-trust-token-12345';
const SERVICE_API_KEY = 'direct-service-api-key';
const PARTNER_RAW_KEY = 'partner-raw-static-key';

const encodeUserinfo = (claims: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(claims)).toString('base64');

type Handler = () => void;

/** Handlers carrying the same metadata the real decorators set */
const makeHandler = (meta: {
  public?: boolean;
  partner?: boolean;
}): Handler => {
  const handler: Handler = () => undefined;
  if (meta.public) SetMetadata(IS_PUBLIC_KEY, true)(handler);
  if (meta.partner) SetMetadata(IS_PARTNER_API_KEY, true)(handler);
  return handler;
};

const HANDLERS = {
  public: makeHandler({ public: true }),
  partner: makeHandler({ partner: true }),
  // @ApiBearerAuth() + @PartnerApi(): the guard only sees the partner metadata
  dual: makeHandler({ partner: true }),
  jwtOnly: makeHandler({}),
} as const;
type HandlerKind = keyof typeof HANDLERS;

const TRUST_HEADERS = {
  valid: { 'x-kong-trust': KONG_TRUST_TOKEN },
  absent: {},
  wrong: { 'x-kong-trust': 'wrong-token' },
} as const;
type TrustKind = keyof typeof TRUST_HEADERS;

const CALLER_HEADERS = {
  user: {
    'x-userinfo': encodeUserinfo({
      sub: 'user-123',
      email: 'user@example.com',
      systemRole: 'USER',
    }),
    'x-credential-identifier': 'alice',
  },
  apiKey: { 'x-api-key-id': 'key-1', 'x-api-key-consumer': 'acme-corp' },
  // Consumer headers of Kong's bundled key-auth (static keys, removed):
  // no identity
  keyAuth: {
    'x-consumer-username': 'acme-corp',
    'x-consumer-id': 'consumer-uuid',
    'x-credential-identifier': 'credential-uuid',
  },
  service: { 'x-api-key': SERVICE_API_KEY, 'x-service-name': 'bff-service' },
  none: {},
  // No Kong route sets both a user and a key identity: treated as forged
  userAndApiKey: {
    'x-userinfo': encodeUserinfo({ sub: 'user-123' }),
    'x-api-key-id': 'key-1',
    'x-api-key-consumer': 'acme-corp',
  },
  // X-Consumer-Username is not an identity header: the user wins
  userAndKeyAuth: {
    'x-userinfo': encodeUserinfo({
      sub: 'user-123',
      email: 'user@example.com',
      systemRole: 'USER',
    }),
    'x-consumer-username': 'acme-corp',
  },
  // A static-key request as key-auth forwarded it: the raw partner key plus
  // key-auth's consumer headers. Without the key plugin's headers it has no
  // gateway identity; the raw key is checked as a service key.
  partnerRawKeyWithConsumer: {
    'x-api-key': PARTNER_RAW_KEY,
    'x-consumer-username': 'acme-corp',
    'x-consumer-id': 'consumer-uuid',
    'x-credential-identifier': 'credential-uuid',
  },
  // The raw partner key alone: checked as a service key
  partnerRawKeyWithoutConsumer: { 'x-api-key': PARTNER_RAW_KEY },
} as const;
type CallerKind = keyof typeof CALLER_HEADERS;

interface TestRequest extends Partial<AuthenticatedRequest> {
  headers: Record<string, string>;
  url: string;
}

const createContext = (
  headers: Record<string, string>,
  handler: Handler,
  url = '/offers/v1/plans',
): { context: ExecutionContext; request: TestRequest } => {
  const request: TestRequest = { headers, url };
  class TestController {}
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => TestController,
  } as unknown as ExecutionContext;
  return { context, request };
};

type Outcome = 'user' | 'apiKey' | 'service' | 'anonymous' | 401 | 403;

/**
 * Expected result for every trust × caller × handler combination.
 */
const expectedOutcome = (
  trust: TrustKind,
  caller: CallerKind,
  handler: HandlerKind,
): Outcome => {
  if (trust === 'wrong') return 401;

  const isPublic = handler === 'public';
  const isPartner = handler === 'partner' || handler === 'dual';

  if (caller === 'service') return 'service';

  if (trust === 'valid') {
    if (caller === 'userAndApiKey') return 401;
    if (caller === 'user' || caller === 'userAndKeyAuth') return 'user';
    if (caller === 'apiKey') {
      return isPartner ? 'apiKey' : 403;
    }
  }

  // No gateway identity. A partner raw key left in x-api-key is checked as a
  // service key: wrong key, 403 (ignored on public handlers).
  const hasWrongServiceKey =
    caller === 'partnerRawKeyWithConsumer' ||
    caller === 'partnerRawKeyWithoutConsumer';
  if (isPublic) return 'anonymous';
  if (hasWrongServiceKey) return 403;
  return 401;
};

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let secrets: Record<string, string | undefined>;

  beforeEach(() => {
    secrets = {
      KONG_TRUST_TOKEN: KONG_TRUST_TOKEN,
      API_KEY: SERVICE_API_KEY,
    };
    const mockSecretsService = {
      get: rs.fn((key: string) => Promise.resolve(secrets[key])),
    } as unknown as SecretsService;
    guard = new AuthGuard(new Reflector(), mockSecretsService);
  });

  describe('Classification matrix (trust × caller × handler)', () => {
    const trusts: TrustKind[] = ['valid', 'absent', 'wrong'];
    const callers: CallerKind[] = [
      'user',
      'apiKey',
      'keyAuth',
      'service',
      'none',
      'userAndApiKey',
      'userAndKeyAuth',
      'partnerRawKeyWithConsumer',
      'partnerRawKeyWithoutConsumer',
    ];
    const handlers: HandlerKind[] = ['public', 'partner', 'dual', 'jwtOnly'];

    for (const trust of trusts) {
      for (const caller of callers) {
        for (const handler of handlers) {
          const outcome = expectedOutcome(trust, caller, handler);

          it(`trust ${trust}, caller ${caller}, handler ${handler} -> ${outcome}`, async () => {
            const { context, request } = createContext(
              { ...TRUST_HEADERS[trust], ...CALLER_HEADERS[caller] },
              HANDLERS[handler],
            );

            if (outcome === 401) {
              await expect(guard.canActivate(context)).rejects.toThrow(
                UnauthorizedException,
              );
              return;
            }
            if (outcome === 403) {
              await expect(guard.canActivate(context)).rejects.toThrow(
                ForbiddenException,
              );
              return;
            }

            await expect(guard.canActivate(context)).resolves.toBe(true);

            switch (outcome) {
              case 'user':
                expect(request.authType).toBe('user');
                expect(request.user).toEqual({
                  id: 'user-123',
                  email: 'user@example.com',
                  systemRole: 'USER',
                });
                expect(request.apiKey).toBeUndefined();
                expect(request.service).toBeUndefined();
                break;
              case 'apiKey':
                expect(request.authType).toBe('apiKey');
                expect(request.apiKey).toEqual({
                  id: 'key-1',
                  consumer: 'acme-corp',
                });
                expect(request.service).toBe('partner');
                expect(request.user).toBeUndefined();
                break;
              case 'service':
                expect(request.authType).toBe('service');
                expect(request.service).toBe('bff-service');
                expect(request.user).toBeUndefined();
                expect(request.apiKey).toBeUndefined();
                break;
              case 'anonymous':
                expect(request.authType).toBeUndefined();
                expect(request.user).toBeUndefined();
                expect(request.apiKey).toBeUndefined();
                expect(request.service).toBeUndefined();
                break;
            }
          });
        }
      }
    }
  });

  describe('Forged identity headers without the trust token', () => {
    it('should reject a forged X-Userinfo with 401', async () => {
      const { context, request } = createContext(
        CALLER_HEADERS.user,
        HANDLERS.jwtOnly,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'No authentication provided',
      );
      expect(request.user).toBeUndefined();
    });

    it('should reject forged key plugin headers with 401', async () => {
      const { context } = createContext(
        CALLER_HEADERS.apiKey,
        HANDLERS.partner,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject forged X-Consumer-Id with 401 (it never means a user)', async () => {
      const { context } = createContext(
        { 'x-consumer-id': 'user-123' },
        HANDLERS.jwtOnly,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should not attach a forged user on a public handler', async () => {
      const { context, request } = createContext(
        CALLER_HEADERS.user,
        HANDLERS.public,
      );
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it('should keep a valid service call a service, ignoring forged identity headers', async () => {
      const { context, request } = createContext(
        { ...CALLER_HEADERS.service, ...CALLER_HEADERS.user },
        HANDLERS.jwtOnly,
      );
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.authType).toBe('service');
      expect(request.user).toBeUndefined();
    });
  });

  describe('Trusted identity headers', () => {
    it('should reject a partner key on a JWT-only handler with 403', async () => {
      const { context } = createContext(
        { ...TRUST_HEADERS.valid, ...CALLER_HEADERS.apiKey },
        HANDLERS.jwtOnly,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'API keys cannot access this endpoint',
      );
    });

    it('should never classify X-Credential-Identifier alone as a user', async () => {
      const { context, request } = createContext(
        { ...TRUST_HEADERS.valid, 'x-credential-identifier': 'user-123' },
        HANDLERS.jwtOnly,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(request.user).toBeUndefined();
    });

    it('should ignore legacy X-JWT-Claim-* headers', async () => {
      const { context, request } = createContext(
        {
          ...TRUST_HEADERS.valid,
          'x-jwt-claim-email': 'user@example.com',
          'x-consumer-id': 'user-123',
        },
        HANDLERS.jwtOnly,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(request.user).toBeUndefined();
    });

    it('should give no identity for an unparseable X-Userinfo', async () => {
      const { context, request } = createContext(
        { ...TRUST_HEADERS.valid, 'x-userinfo': 'not-json' },
        HANDLERS.jwtOnly,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(request.user).toBeUndefined();
    });

    it('should keep claim types from X-Userinfo', async () => {
      const { context, request } = createContext(
        {
          ...TRUST_HEADERS.valid,
          'x-userinfo': encodeUserinfo({
            sub: 'user-1',
            roles: ['EDITOR', 'BILLING'],
            confirmed: true,
            iat: 1700000000,
          }),
        },
        HANDLERS.jwtOnly,
      );
      await guard.canActivate(context);
      expect(request.user).toEqual({
        id: 'user-1',
        roles: ['EDITOR', 'BILLING'],
        confirmed: true,
        iat: 1700000000,
      });
    });

    it('should classify a user even when a service x-api-key is also forwarded', async () => {
      const { context, request } = createContext(
        {
          ...TRUST_HEADERS.valid,
          ...CALLER_HEADERS.user,
          'x-api-key': SERVICE_API_KEY,
        },
        HANDLERS.jwtOnly,
      );
      await guard.canActivate(context);
      expect(request.authType).toBe('user');
    });

    it('should treat X-Userinfo together with key headers as forged (401)', async () => {
      const { context, request } = createContext(
        {
          ...TRUST_HEADERS.valid,
          ...CALLER_HEADERS.user,
          ...CALLER_HEADERS.apiKey,
        },
        HANDLERS.partner,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Unauthorized request',
      );
      expect(request.authType).toBeUndefined();
      expect(request.user).toBeUndefined();
      expect(request.apiKey).toBeUndefined();
    });

    it('should reject conflicting identity headers even on a public handler', async () => {
      const { context } = createContext(
        { ...TRUST_HEADERS.valid, ...CALLER_HEADERS.userAndApiKey },
        HANDLERS.public,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Static partner keys (key-auth headers, no longer supported)', () => {
    it("rejects the raw partner key plus key-auth consumer headers with 403 'Invalid API key' (no gateway identity; the raw key is checked as a service key)", async () => {
      const { context, request } = createContext(
        { ...TRUST_HEADERS.valid, ...CALLER_HEADERS.partnerRawKeyWithConsumer },
        HANDLERS.partner,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Invalid API key',
      );
      expect(request.authType).toBeUndefined();
      expect(request.apiKey).toBeUndefined();
      expect(request.user).toBeUndefined();
    });

    it("rejects the raw partner key alone with 403 'Invalid API key'", async () => {
      const { context } = createContext(
        {
          ...TRUST_HEADERS.valid,
          ...CALLER_HEADERS.partnerRawKeyWithoutConsumer,
        },
        HANDLERS.partner,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Invalid API key',
      );
    });
  });

  describe('Gateway flag (viaGateway)', () => {
    it('should set viaGateway after a valid trust token', async () => {
      const { context, request } = createContext(
        { ...TRUST_HEADERS.valid },
        HANDLERS.public,
      );
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.viaGateway).toBe(true);
    });

    it('should not set viaGateway without a trust token (direct or internal call)', async () => {
      const { context, request } = createContext(
        { ...CALLER_HEADERS.service },
        HANDLERS.jwtOnly,
      );
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.viaGateway).toBeUndefined();
    });

    it('should not set viaGateway on infrastructure paths', async () => {
      const { context, request } = createContext(
        { ...TRUST_HEADERS.valid },
        HANDLERS.public,
        '/health',
      );
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.viaGateway).toBeUndefined();
    });

    it('should not set viaGateway for a wrong trust token', async () => {
      const { context, request } = createContext(
        { ...TRUST_HEADERS.wrong },
        HANDLERS.public,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(request.viaGateway).toBeUndefined();
    });
  });

  describe('Infrastructure path exemption', () => {
    it.each([
      '/health',
      '/health/ping',
      '/metrics',
      '/auth/.well-known/jwks.json',
      '/auth/.well-known/openid-configuration',
    ])('should ignore a wrong trust token on %s', async (url) => {
      const { context, request } = createContext(
        TRUST_HEADERS.wrong,
        HANDLERS.public,
        url,
      );
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.authType).toBeUndefined();
    });

    it('should ignore identity headers on infrastructure paths, even with a valid token', async () => {
      const { context, request } = createContext(
        { ...TRUST_HEADERS.valid, ...CALLER_HEADERS.user },
        HANDLERS.jwtOnly,
        '/health',
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(request.user).toBeUndefined();
    });

    it('should not exempt a path that has an infrastructure path only in its query string', async () => {
      const { context } = createContext(
        TRUST_HEADERS.wrong,
        HANDLERS.public,
        '/offers/v1/plans?next=/health',
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Unauthorized request',
      );
    });

    it('should not exempt a query string containing /.well-known/', async () => {
      const { context } = createContext(
        TRUST_HEADERS.wrong,
        HANDLERS.public,
        '/offers/v1/plans?x=/.well-known/',
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should not exempt paths that only contain "well-known" without the dot', async () => {
      const { context } = createContext(
        TRUST_HEADERS.wrong,
        HANDLERS.public,
        '/auth/well-known/jwks.json',
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should use request.path when url is missing', async () => {
      const request = {
        headers: TRUST_HEADERS.wrong as Record<string, string>,
        path: '/health',
      };
      class TestController {}
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => HANDLERS.public,
        getClass: () => TestController,
      } as unknown as ExecutionContext;
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe('Service API key', () => {
    it('should reject a wrong service key on a JWT-only handler with 403', async () => {
      const { context } = createContext(
        { 'x-api-key': 'wrong-key' },
        HANDLERS.jwtOnly,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject a wrong service key on a partner handler with 403', async () => {
      const { context } = createContext(
        { ...TRUST_HEADERS.valid, 'x-api-key': 'wrong-key' },
        HANDLERS.partner,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should ignore a wrong service key on a public handler', async () => {
      const { context, request } = createContext(
        { ...TRUST_HEADERS.valid, 'x-api-key': 'wrong-key' },
        HANDLERS.public,
      );
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.authType).toBeUndefined();
      expect(request.service).toBeUndefined();
    });

    it("should default the service name to 'internal'", async () => {
      const { context, request } = createContext(
        { 'x-api-key': SERVICE_API_KEY },
        HANDLERS.jwtOnly,
      );
      await guard.canActivate(context);
      expect(request.service).toBe('internal');
    });

    it('should authenticate a service key forwarded with a valid trust token', async () => {
      const { context, request } = createContext(
        { ...TRUST_HEADERS.valid, ...CALLER_HEADERS.service },
        HANDLERS.jwtOnly,
      );
      await guard.canActivate(context);
      expect(request.authType).toBe('service');
    });

    it('should reject with 401 when API_KEY is not configured', async () => {
      secrets.API_KEY = undefined;
      const { context } = createContext(
        CALLER_HEADERS.service,
        HANDLERS.jwtOnly,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Server API key is not configured',
      );
    });
  });

  describe('Configuration errors', () => {
    it('should reject with 401 when KONG_TRUST_TOKEN is not configured', async () => {
      secrets.KONG_TRUST_TOKEN = undefined;
      const { context } = createContext(
        { ...TRUST_HEADERS.valid, ...CALLER_HEADERS.user },
        HANDLERS.jwtOnly,
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Authentication configuration error',
      );
    });
  });

  describe('Decorator placement', () => {
    it('should read @PartnerApi() from the controller class', async () => {
      const handler: Handler = () => undefined;
      class PartnerController {}
      SetMetadata(IS_PARTNER_API_KEY, true)(PartnerController);
      const request: TestRequest = {
        headers: { ...TRUST_HEADERS.valid, ...CALLER_HEADERS.apiKey },
        url: '/bff/v1/upload-test',
      };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => handler,
        getClass: () => PartnerController,
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.authType).toBe('apiKey');
    });

    it('should read @Public() from the controller class', async () => {
      const handler: Handler = () => undefined;
      class PublicController {}
      SetMetadata(IS_PUBLIC_KEY, true)(PublicController);
      const request: TestRequest = { headers: {}, url: '/health' };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => handler,
        getClass: () => PublicController,
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });
});
