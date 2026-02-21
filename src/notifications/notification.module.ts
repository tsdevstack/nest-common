/**
 * Notification Module
 *
 * Provides NotificationService for sending emails (and future SMS/push).
 *
 * Provider selection based on EMAIL_PROVIDER secret:
 * - "console" (default): Logs to console (local development)
 * - "resend": Sends via Resend API (cloud)
 *
 * Usage:
 * ```typescript
 * @Module({
 *   imports: [NotificationModule],
 * })
 * export class AppModule {}
 *
 * @Injectable()
 * export class MyService {
 *   constructor(private notifications: NotificationService) {}
 *
 *   async sendWelcome(email: string) {
 *     await this.notifications.sendEmail({
 *       to: email,
 *       subject: 'Welcome!',
 *       html: '<h1>Welcome to our app!</h1>',
 *     });
 *   }
 * }
 * ```
 */
import { Module } from '@nestjs/common';
import { NotificationService, EMAIL_PROVIDER } from './notification.service';
import { ConsoleEmailProvider } from './providers/email/console.provider';
import { ResendEmailProvider } from './providers/email/resend.provider';
import { SecretsService } from '../secrets/secrets.service';
import { LoggerService } from '../logging/logger.service';

@Module({
  providers: [
    NotificationService,
    {
      provide: EMAIL_PROVIDER,
      useFactory: async (secrets: SecretsService, logger: LoggerService) => {
        let provider = 'console';

        try {
          provider = await secrets.get('EMAIL_PROVIDER');
        } catch {
          // EMAIL_PROVIDER not set, default to console
        }

        if (provider === 'resend') {
          // Create ResendEmailProvider - NestJS will call onModuleInit
          const resendProvider = new ResendEmailProvider(secrets);
          await resendProvider.onModuleInit();
          return resendProvider;
        }

        return new ConsoleEmailProvider(logger);
      },
      inject: [SecretsService, LoggerService],
    },
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
