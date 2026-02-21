# @tsdevstack/nest-common

Shared NestJS modules for tsdevstack microservices. Provides auth, rate limiting, secrets management, observability, notifications, database connectivity, and application bootstrap — so every service starts with production-ready infrastructure.

## Features

- **Authentication** — Kong JWT validation guard with public/partner route decorators
- **Rate Limiting** — Redis-backed rate limiting with per-route configuration
- **Email Rate Limiting** — Dedicated rate limiter for email-sending endpoints
- **Secrets Management** — Multi-provider secrets (GCP Secret Manager, AWS Secrets Manager, Azure Key Vault)
- **Observability** — Logging (Pino), metrics (Prometheus/OpenTelemetry), tracing (OTLP), health checks
- **Database** — Prisma connection pooling with `pg` adapter and SSL support
- **Notifications** — Email (Resend), SMS, and push notification service
- **Background Jobs** — BullMQ configuration and scheduler guard
- **Service Client** — Type-safe HTTP client for inter-service communication
- **Bootstrap** — `startApp()` and `startWorker()` for consistent app initialization

## Installation

```bash
npm install @tsdevstack/nest-common
```

## Quick Start

### Bootstrap a service

```typescript
import { startApp } from '@tsdevstack/nest-common';
import { AppModule } from './app.module';

startApp(AppModule, {
  serviceName: 'my-service',
  port: 3000,
});
```

### Import modules

```typescript
import {
  AuthModule,
  RedisModule,
  RateLimitModule,
  ObservabilityModule,
  SecretsModule,
} from '@tsdevstack/nest-common';

@Module({
  imports: [
    ObservabilityModule.register({ serviceName: 'my-service' }),
    SecretsModule,
    AuthModule,
    RedisModule,
    RateLimitModule,
  ],
})
export class AppModule {}
```

### Protect routes

```typescript
import { AuthGuard, Public, RateLimit } from '@tsdevstack/nest-common';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @RateLimit({ points: 10, duration: 60 })
  @Get('profile')
  getProfile(@Req() req: AuthenticatedRequest) {
    return req.user;
  }
}
```

## Modules

| Module | Description |
|--------|-------------|
| `AuthModule` | Kong JWT validation, `@Public()` and `@PartnerApi()` decorators |
| `RedisModule` | Redis connection with retry and health checks |
| `RateLimitModule` | Redis-backed rate limiting with `@RateLimit()` decorator |
| `EmailRateLimitModule` | Dedicated email rate limiting |
| `SecretsModule` | Multi-cloud secrets loading (GCP, AWS, Azure) |
| `ObservabilityModule` | Logging, metrics, tracing, and health endpoints |
| `NotificationModule` | Email (Resend), SMS, and push notifications |
| `BullConfigModule` | BullMQ queue configuration |

## Utilities

| Export | Description |
|--------|-------------|
| `startApp()` | Bootstrap a NestJS application with standard middleware |
| `startWorker()` | Bootstrap a background worker process |
| `createPrismaConnection()` | Prisma client with `pg` adapter and SSL |
| `BaseServiceClient` | HTTP client for service-to-service calls |
| `filterForwardHeaders()` | Header filtering for inter-service requests |
| `generateSwaggerDocs()` | OpenAPI documentation setup |
| `LoggerService` | Pino-based structured logging |
| `MetricsService` | Custom Prometheus metrics |

## License

MIT