import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockSecretsGet, MockResend, MockConsole, capturedFactoryHolder } =
  rs.hoisted(() => ({
    mockSecretsGet: rs.fn(),
    MockResend: class {
      onModuleInit = rs.fn().mockResolvedValue(undefined);
    },
    MockConsole: class {},
    capturedFactoryHolder: {
      fn: undefined as ((...args: unknown[]) => Promise<unknown>) | undefined,
    },
  }));

rs.mock('@nestjs/common', () => ({
  Module:
    (opts: {
      providers: Array<{
        useFactory?: (...args: unknown[]) => Promise<unknown>;
      }>;
    }) =>
    () => {
      const emailProvider = opts.providers?.find(
        (p: Record<string, unknown>) => p.useFactory,
      );
      if (emailProvider) {
        capturedFactoryHolder.fn = emailProvider.useFactory;
      }
    },
  Inject: () => () => {},
}));

rs.mock('../secrets/secrets.service', () => ({
  SecretsService: class {},
}));

rs.mock('../logging/logger.service', () => ({
  LoggerService: class {},
}));

rs.mock('./providers/email/resend.provider', () => ({
  ResendEmailProvider: MockResend,
}));

rs.mock('./providers/email/console.provider', () => ({
  ConsoleEmailProvider: MockConsole,
}));

rs.mock('./notification.service', () => ({
  NotificationService: class {},
  EMAIL_PROVIDER: 'EMAIL_PROVIDER',
}));

// Import to trigger module decorator capture
import './notification.module';

describe('NotificationModule', () => {
  let mockSecrets: { get: ReturnType<typeof rs.fn> };
  let mockLogger: Record<string, unknown>;

  beforeEach(() => {
    rs.clearAllMocks();
    mockSecrets = { get: mockSecretsGet };
    mockLogger = {};
  });

  describe('EMAIL_PROVIDER factory', () => {
    it('should default to console provider when secret not set', async () => {
      mockSecretsGet.mockRejectedValue(new Error('not found'));

      const result = await capturedFactoryHolder.fn!(mockSecrets, mockLogger);

      expect(result).toBeInstanceOf(MockConsole);
    });

    it('should create resend provider when EMAIL_PROVIDER is resend', async () => {
      mockSecretsGet.mockResolvedValue('resend');

      const result = await capturedFactoryHolder.fn!(mockSecrets, mockLogger);

      expect(result).toBeInstanceOf(MockResend);
    });

    it('should call onModuleInit on resend provider', async () => {
      mockSecretsGet.mockResolvedValue('resend');

      const result = await capturedFactoryHolder.fn!(mockSecrets, mockLogger);

      expect(
        (result as InstanceType<typeof MockResend>).onModuleInit,
      ).toHaveBeenCalled();
    });

    it('should create console provider for unknown provider value', async () => {
      mockSecretsGet.mockResolvedValue('unknown');

      const result = await capturedFactoryHolder.fn!(mockSecrets, mockLogger);

      expect(result).toBeInstanceOf(MockConsole);
    });
  });
});
