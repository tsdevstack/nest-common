import { describe, it, expect, rs } from '@rstest/core';

const { mockForRootAsync } = rs.hoisted(() => ({
  mockForRootAsync: rs.fn().mockReturnValue({
    module: class {},
    providers: [],
    exports: [],
  }),
}));

rs.mock('@nestjs/bullmq', () => ({
  BullModule: {
    forRootAsync: mockForRootAsync,
  },
}));

rs.mock('../secrets/secrets.module', () => ({
  SecretsModule: class {},
}));

rs.mock('../secrets/secrets.service', () => ({
  SecretsService: class {},
}));

import { BullConfigModule } from './bull-config.module';

describe('BullConfigModule', () => {
  describe('forRoot', () => {
    it('should call BullModule.forRootAsync', () => {
      BullConfigModule.forRoot();

      expect(mockForRootAsync).toHaveBeenCalledTimes(1);
    });

    it('should pass useFactory configuration', () => {
      BullConfigModule.forRoot();

      const config = mockForRootAsync.mock.calls[0][0];
      expect(config.useFactory).toBeDefined();
      expect(typeof config.useFactory).toBe('function');
    });

    describe('useFactory', () => {
      it('should configure Redis connection from secrets', async () => {
        BullConfigModule.forRoot();

        const config = mockForRootAsync.mock.calls[0][0];
        const mockSecrets = {
          get: rs.fn().mockImplementation((key: string) => {
            const secrets: Record<string, string> = {
              REDIS_HOST: 'redis.example.com',
              REDIS_PORT: '6380',
              REDIS_PASSWORD: 'secret',
              REDIS_TLS: 'false',
            };
            return Promise.resolve(secrets[key] || '');
          }),
        };

        const result = await config.useFactory(mockSecrets);

        expect(result.connection.host).toBe('redis.example.com');
        expect(result.connection.port).toBe(6380);
        expect(result.connection.password).toBe('secret');
      });

      it('should set bull prefix', async () => {
        BullConfigModule.forRoot();

        const config = mockForRootAsync.mock.calls[0][0];
        const mockSecrets = {
          get: rs.fn().mockResolvedValue('val'),
        };

        const result = await config.useFactory(mockSecrets);

        expect(result.prefix).toBe('{bull}');
      });

      it('should enable TLS when REDIS_TLS is true', async () => {
        BullConfigModule.forRoot();

        const config = mockForRootAsync.mock.calls[0][0];
        const mockSecrets = {
          get: rs.fn().mockImplementation((key: string) => {
            if (key === 'REDIS_TLS') return Promise.resolve('true');
            return Promise.resolve('val');
          }),
        };

        const result = await config.useFactory(mockSecrets);

        expect(result.connection.tls).toEqual({});
      });

      it('should set default job options', async () => {
        BullConfigModule.forRoot();

        const config = mockForRootAsync.mock.calls[0][0];
        const mockSecrets = {
          get: rs.fn().mockResolvedValue('val'),
        };

        const result = await config.useFactory(mockSecrets);

        expect(result.defaultJobOptions.attempts).toBe(3);
        expect(result.defaultJobOptions.backoff.type).toBe('exponential');
        expect(result.connection.maxRetriesPerRequest).toBeNull();
      });
    });
  });
});
