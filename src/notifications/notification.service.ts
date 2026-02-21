/**
 * Notification Service
 *
 * Unified service for sending notifications (email, SMS, push).
 * Currently only email is implemented via providers (Console for local, Resend for cloud).
 */
import { Injectable, Inject } from '@nestjs/common';
import type { EmailOptions } from './interfaces/email-options.interface';
import type { SMSOptions } from './interfaces/sms-options.interface';
import type { PushOptions } from './interfaces/push-options.interface';
import type { EmailProvider } from './providers/email-provider.interface';

export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';

@Injectable()
export class NotificationService {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  /**
   * Send an email
   * Uses the configured email provider (Console for local, Resend for cloud)
   */
  async sendEmail(options: EmailOptions): Promise<void> {
    await this.emailProvider.send(options);
  }

  /**
   * Send an SMS (not implemented)
   * @throws Error - SMS not implemented in v1
   */
  async sendSMS(_options: SMSOptions): Promise<void> {
    throw new Error('SMS notifications are not implemented. Coming in a future version.');
  }

  /**
   * Send a push notification (not implemented)
   * @throws Error - Push not implemented in v1
   */
  async sendPush(_options: PushOptions): Promise<void> {
    throw new Error('Push notifications are not implemented. Coming in a future version.');
  }

  /**
   * Get the current email provider name
   */
  getEmailProviderName(): string {
    return this.emailProvider.getName();
  }
}
