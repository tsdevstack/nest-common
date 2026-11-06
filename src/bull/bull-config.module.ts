import { Module, type DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SecretsModule } from '../secrets/secrets.module';
import { SecretsService } from '../secrets/secrets.service';
import { REDIS_PROTOCOL } from '../redis/redis.constants';
import { createBullMqTelemetry } from './create-bullmq-telemetry';

/**
 * BullConfigModule
 *
 * Configures BullMQ with Redis connection from SecretsService.
 * Portable across GCP/AWS/Azure/k8s - just needs Redis.
 *
 * Every queue and worker gets telemetry: a job runs in the trace of the
 * request that queued it, and its own spans show the wait and the work.
 * The queue's housekeeping (stalled job checks and such) is not traced.
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
          telemetry: createBullMqTelemetry(),
          connection: {
            host: await secrets.get('REDIS_HOST'),
            port: parseInt(await secrets.get('REDIS_PORT'), 10) || 6379,
            password: await secrets.get('REDIS_PASSWORD'),
            // AWS ElastiCache requires TLS when transit_encryption_enabled = true
            ...(redisTls === 'true' && { tls: {} }),
            protocol: REDIS_PROTOCOL,
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
