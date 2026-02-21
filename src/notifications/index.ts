/**
 * Notifications Module
 *
 * Provides email (and future SMS/push) notification capabilities.
 *
 * @packageDocumentation
 */

export { NotificationModule } from './notification.module';
export { NotificationService, EMAIL_PROVIDER } from './notification.service';
export type { EmailOptions } from './interfaces/email-options.interface';
export type { SMSOptions } from './interfaces/sms-options.interface';
export type { PushOptions } from './interfaces/push-options.interface';
export type { EmailProvider } from './providers/email-provider.interface';
export { ConsoleEmailProvider } from './providers/email/console.provider';
export { ResendEmailProvider } from './providers/email/resend.provider';
