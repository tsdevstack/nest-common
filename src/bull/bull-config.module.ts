import { Module, type DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SecretsModule } from '../secrets/secrets.module';
import { SecretsService } from '../secrets/secrets.service';

/**
 * BullConfigModule
 *
 * Configures BullMQ with Redis connection from SecretsService.
 * Portable across GCP/AWS/Azure/k8s - just needs Redis.
 *
 * Usage:
 * ```typescript
 * @Module({
 *   imports: [
 *     BullConfigModule.forRoot(),
 *     BullModule.registerQueue({ name: 'email' }),
 *   ],
 *   providers: [EmailProcessor],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class BullConfigModule {
  static forRoot(): DynamicModule {
    return BullModule.forRootAsync({
      imports: [SecretsModule],
      inject: [SecretsService],
      useFactory: async (secrets: SecretsService) => {
        const redisTls = await secrets.get('REDIS_TLS');
        return {
          prefix: '{bull}',
          connection: {
            host: await secrets.get('REDIS_HOST'),
            port: parseInt(await secrets.get('REDIS_PORT'), 10) || 6379,
            password: await secrets.get('REDIS_PASSWORD'),
            // AWS ElastiCache requires TLS when transit_encryption_enabled = true
            ...(redisTls === 'true' && { tls: {} }),
            maxRetriesPerRequest: null, // Required for workers - survives Redis blips
          },
          defaultJobOptions: {
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 500 },
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
          },
        };
      },
    });
  }
}
