import { describe, it, expect, beforeEach, rs, afterEach } from '@rstest/core';
import type { ExecutionContext } from '@nestjs/common';
import type { SecretsService } from '../secrets/secrets.service';

// Create a shared mock for verifyIdToken that can be configured per test
const mockVerifyIdToken = rs.fn();

// Mock google-auth-library before importing the guard
rs.mock('google-auth-library', () => ({
  OAuth2Client: class MockOAuth2Client {
    verifyIdToken = mockVerifyIdToken;
  },
}));

// Import after mocking
import { SchedulerGuard } from './scheduler.guard';

describe('SchedulerGuard', () => {
  let guard: SchedulerGuard;
  let mockSecretsService: SecretsService;
  let originalSecretsProvider: string | undefined;
  let originalServiceName: string | undefined;

  const createMockExecutionContext = (
    headers: Record<string, string | undefined>,
  ): ExecutionContext => {
    const request = { headers };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as ExecutionContext;
  };

  beforeEach(() => {
    originalSecretsProvider = process.env.SECRETS_PROVIDER;
    originalServiceName = process.env.SERVICE_NAME;
    process.env.SECRETS_PROVIDER = 'gcp';
    process.env.SERVICE_NAME = 'auth-service';

    mockSecretsService = {
      get: rs.fn(),
    } as unknown as SecretsService;

    // Reset the mock before each test
    mockVerifyIdToken.mockReset();

    guard = new SchedulerGuard(mockSecretsService);
  });

  afterEach(() => {
    process.env.SECRETS_PROVIDER = originalSecretsProvider;
    process.env.SERVICE_NAME = originalServiceName;
  });

  describe('Local mode', () => {
    it('should skip validation when SECRETS_PROVIDER is local', async () => {
      process.env.SECRETS_PROVIDER = 'local';

      const context = createMockExecutionContext({});

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockSecretsService.get).not.toHaveBeenCalled();
    });

    it('should skip validation even without Authorization header in local mode', async () => {
      process.env.SECRETS_PROVIDER = 'local';

      const context = createMockExecutionContext({
        'content-type': 'application/json',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('GCP provider', () => {
    beforeEach(() => {
      process.env.SECRETS_PROVIDER = 'gcp';
      process.env.SERVICE_NAME = 'auth-service';

      rs.mocked(mockSecretsService.get).mockImplementation((key: string) => {
        // Guard now fetches AUTH_SERVICE_URL (derived from SERVICE_NAME)
        if (key === 'AUTH_SERVICE_URL')
          return Promise.resolve('https://auth-service-abc123.run.app');
        return Promise.resolve('');
      });
    });

    it('should reject requests without Authorization header', async () => {
      const context = createMockExecutionContext({});

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should reject requests with non-Bearer Authorization header', async () => {
      const context = createMockExecutionContext({
        authorization: 'Basic dXNlcjpwYXNz',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should validate Bearer token against GCP OIDC', async () => {
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'scheduler@project.iam.gserviceaccount.com',
        }),
      });

      const context = createMockExecutionContext({
        authorization: 'Bearer valid-oidc-token',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: 'valid-oidc-token',
        audience: 'https://auth-service-abc123.run.app',
      });
    });

    it('should derive URL secret key from SERVICE_NAME', async () => {
      process.env.SERVICE_NAME = 'bff-service';

      rs.mocked(mockSecretsService.get).mockImplementation((key: string) => {
        if (key === 'BFF_SERVICE_URL')
          return Promise.resolve('https://bff-service-xyz.run.app');
        return Promise.resolve('');
      });

      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'scheduler@project.iam.gserviceaccount.com',
        }),
      });

      const context = createMockExecutionContext({
        authorization: 'Bearer valid-oidc-token',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockSecretsService.get).toHaveBeenCalledWith('BFF_SERVICE_URL');
    });

    it('should reject invalid OIDC token', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'));

      const context = createMockExecutionContext({
        authorization: 'Bearer invalid-token',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should return false when SERVICE_NAME is not set', async () => {
      delete process.env.SERVICE_NAME;

      const context = createMockExecutionContext({
        authorization: 'Bearer valid-oidc-token',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });
  });

  describe('AWS provider', () => {
    const validJobSecret = 'super-secret-job-auth-token-12345';

    beforeEach(() => {
      process.env.SECRETS_PROVIDER = 'aws';

      rs.mocked(mockSecretsService.get).mockImplementation((key: string) => {
        if (key === 'JOB_AUTH_SECRET') return Promise.resolve(validJobSecret);
        return Promise.resolve('');
      });
    });

    it('should reject requests without X-Job-Secret header', async () => {
      const context = createMockExecutionContext({});

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should reject requests with Authorization header but no X-Job-Secret', async () => {
      const context = createMockExecutionContext({
        authorization: 'Bearer some-token',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should validate valid X-Job-Secret header', async () => {
      const context = createMockExecutionContext({
        'x-job-secret': validJobSecret,
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockSecretsService.get).toHaveBeenCalledWith('JOB_AUTH_SECRET');
    });

    it('should reject invalid X-Job-Secret header', async () => {
      const context = createMockExecutionContext({
        'x-job-secret': 'wrong-secret',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should return false when JOB_AUTH_SECRET is not configured', async () => {
      rs.mocked(mockSecretsService.get).mockResolvedValue('');

      const context = createMockExecutionContext({
        'x-job-secret': validJobSecret,
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should return false when secrets service throws error', async () => {
      rs.mocked(mockSecretsService.get).mockRejectedValue(
        new Error('Secrets Manager error'),
      );

      const context = createMockExecutionContext({
        'x-job-secret': validJobSecret,
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });
  });

  describe('Azure provider', () => {
    const validJobSecret = 'azure-job-secret-token-67890';

    beforeEach(() => {
      process.env.SECRETS_PROVIDER = 'azure';

      rs.mocked(mockSecretsService.get).mockImplementation((key: string) => {
        if (key === 'JOB_SECRET') return Promise.resolve(validJobSecret);
        return Promise.resolve('');
      });
    });

    it('should reject requests without X-Job-Secret header', async () => {
      const context = createMockExecutionContext({});

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should validate valid X-Job-Secret header', async () => {
      const context = createMockExecutionContext({
        'x-job-secret': validJobSecret,
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockSecretsService.get).toHaveBeenCalledWith('JOB_SECRET');
    });

    it('should reject invalid X-Job-Secret header', async () => {
      const context = createMockExecutionContext({
        'x-job-secret': 'wrong-secret',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should return false when JOB_SECRET is not configured', async () => {
      rs.mocked(mockSecretsService.get).mockResolvedValue('');

      const context = createMockExecutionContext({
        'x-job-secret': validJobSecret,
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should return false when secrets service throws error', async () => {
      rs.mocked(mockSecretsService.get).mockRejectedValue(
        new Error('Key Vault error'),
      );

      const context = createMockExecutionContext({
        'x-job-secret': validJobSecret,
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });
  });

  describe('Unknown/missing provider', () => {
    it('should return false for unknown SECRETS_PROVIDER', async () => {
      process.env.SECRETS_PROVIDER = 'unknown-provider';

      const context = createMockExecutionContext({
        authorization: 'Bearer some-token',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should return false for empty SECRETS_PROVIDER', async () => {
      process.env.SECRETS_PROVIDER = '';

      const context = createMockExecutionContext({
        authorization: 'Bearer some-token',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });

    it('should return false when SECRETS_PROVIDER is undefined', async () => {
      delete process.env.SECRETS_PROVIDER;

      const context = createMockExecutionContext({
        authorization: 'Bearer some-token',
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
    });
  });
});
