import { Global, Module } from '@nestjs/common';
import { SecretsService } from './secrets.service';

/**
 * Secrets Module
 *
 * Global module that provides SecretsService for runtime secret access.
 * Automatically available in all modules without importing.
 *
 * Usage in any service:
 * ```typescript
 * @Injectable()
 * export class MyService {
 *   constructor(private secrets: SecretsService) {}
 *
 *   async doSomething() {
 *     const apiKey = await this.secrets.get('API_KEY');
 *     // Cached for 1 minute, refreshes automatically
 *   }
 * }
 * ```
 *
 * Note: This module must be imported in AppModule for dependency injection to work.
 * The SecretsService is then available globally in all services.
 */
@Global()
@Module({
  providers: [
    {
      provide: SecretsService,
      useFactory: () => {
        // SERVICE_NAME is set by startApp() during bootstrap
        // startApp() detects service name from package.json and sets process.env.SERVICE_NAME
        // This ensures both startup injection and runtime DI use the same service name
        const serviceName = process.env.SERVICE_NAME;

        if (!serviceName) {
          throw new Error(
            'SERVICE_NAME environment variable is required. ' +
              'This should be set automatically by startApp() during bootstrap.',
          );
        }

        return new SecretsService({
          serviceName,
        });
      },
    },
  ],
  exports: [SecretsService],
})
export class SecretsModule {}