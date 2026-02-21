// Authentication (Phase 1 & 5)
export { AuthModule } from './auth/auth.module';
export { AuthGuard } from './auth/auth.guard';
export { Public, IS_PUBLIC_KEY } from './auth/public.decorator';
export { PartnerApi, IS_PARTNER_API_KEY } from './auth/partner-api.decorator';
export { Partner } from './auth/partner.decorator';
export type { KongUser, AuthenticatedRequest } from './auth/auth-user.interface';
export { KongHeaders } from './auth/auth-user.interface';

// Redis
export { RedisModule } from './redis/redis.module';
export { RedisService } from './redis/redis.service';

// Rate Limiting
export { RateLimitModule } from './rate-limit/rate-limit.module';
export { RateLimitGuard } from './rate-limit/rate-limit.guard';
export { RateLimitDecorator } from './rate-limit/rate-limit.decorator';
export { RateLimitHeadersInterceptor } from './rate-limit/rate-limit-headers.interceptor';

// Rate Limiting - Cleaner API (alias)
export { RateLimitDecorator as RateLimit } from './rate-limit/rate-limit.decorator';

// Email Rate Limiting
export { EmailRateLimitModule } from './email-rate-limit/email-rate-limit.module';
export { EmailRateLimitGuard } from './email-rate-limit/email-rate-limit.guard';
export { EmailRateLimitDecorator } from './email-rate-limit/email-rate-limit.decorator';


// Secrets Management
export { SecretsModule } from './secrets/secrets.module';
export { SecretsService } from './secrets/secrets.service';
export type { SecretsProvider, SecretsConfig, SecretsLoadResult } from './secrets/secrets.interface';

// Service Client
export { BaseServiceClient } from './service-client/base-service-client';
export type { ServiceClientConfig } from './service-client/base-service-client';
export { filterForwardHeaders } from './service-client/filter-forward-headers';

// Bootstrap
export { startApp, loadEnvIfExists } from './bootstrap/create-app';
export { startWorker } from './bootstrap/start-worker';

// OpenAPI Documentation
export { generateSwaggerDocs } from './open-api-docs/generate-swagger-docs';

// Observability (recommended - single import for logging, metrics, tracing, health)
export { ObservabilityModule } from './observability/observability.module';
export type { ObservabilityModuleOptions } from './observability/observability.interface';

// Logging - inject LoggerService in your services
export { LoggerService } from './logging/logger.service';
export type { LogContext } from './logging/logger.service';

// Metrics - inject MetricsService for custom metrics
export { MetricsService } from './metrics/metrics.service';

// Database - Prisma connection pooling
export { createPrismaConnection } from './database/prisma-connection';
export type { PrismaConnectionConfig, PrismaConnectionResult } from './database/prisma-connection';

// Notifications (Phase 18)
export { NotificationModule } from './notifications/notification.module';
export { NotificationService } from './notifications/notification.service';
export type { EmailOptions } from './notifications/interfaces/email-options.interface';
export type { SMSOptions } from './notifications/interfaces/sms-options.interface';
export type { PushOptions } from './notifications/interfaces/push-options.interface';

// Workers & Background Jobs (Phase 20)
export { BullConfigModule } from './bull/bull-config.module';
export { SchedulerGuard } from './scheduler/scheduler.guard';