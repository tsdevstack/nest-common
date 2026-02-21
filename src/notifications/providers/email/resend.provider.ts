/**
 * Resend Email Provider
 *
 * Sends emails via Resend API.
 * Used for cloud environments (GCP, AWS, Azure).
 *
 * Requires secrets:
 * - RESEND_API_KEY: Your Resend API key
 * - EMAIL_FROM: Default sender address (optional, defaults to onboarding@resend.dev)
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Resend } from 'resend';
import type { EmailOptions } from '../../interfaces/email-options.interface';
import type { EmailProvider } from '../email-provider.interface';
import { SecretsService } from '../../../secrets/secrets.service';

@Injectable()
export class ResendEmailProvider implements EmailProvider, OnModuleInit {
  private readonly logger = new Logger(ResendEmailProvider.name);
  private client!: Resend;
  private defaultFrom!: string;

  constructor(private readonly secrets: SecretsService) {}

  async onModuleInit(): Promise<void> {
    const apiKey = await this.secrets.get('RESEND_API_KEY');
    this.client = new Resend(apiKey);

    try {
      this.defaultFrom = await this.secrets.get('EMAIL_FROM');
    } catch {
      // EMAIL_FROM not set, use Resend's default for testing
      this.defaultFrom = 'onboarding@resend.dev';
      this.logger.warn(
        'EMAIL_FROM secret not set, using Resend default: onboarding@resend.dev',
      );
    }

    this.logger.log('Resend email provider initialized');
  }

  async send(options: EmailOptions): Promise<void> {
    const from = options.from || this.defaultFrom;
    const to = Array.isArray(options.to) ? options.to : [options.to];

    this.logger.debug(`Sending email to ${to.join(', ')}: ${options.subject}`);

    // Build payload - Resend requires either html or text
    const payload: {
      from: string;
      to: string[];
      subject: string;
      html?: string;
      text?: string;
      replyTo?: string;
    } = {
      from,
      to,
      subject: options.subject,
    };

    if (options.html) {
      payload.html = options.html;
    }
    if (options.text) {
      payload.text = options.text;
    }
    if (options.replyTo) {
      payload.replyTo = options.replyTo;
    }

    // Ensure at least one content type is provided
    if (!payload.html && !payload.text) {
      payload.text = '(no content)';
    }

    // Type assertion needed due to Resend SDK's complex union types
    const { error } = await this.client.emails.send(
      payload as Parameters<typeof this.client.emails.send>[0],
    );

    if (error) {
      this.logger.error(`Failed to send email: ${error.message}`);
      throw new Error(`Failed to send email: ${error.message}`);
    }

    this.logger.debug(`Email sent successfully to ${to.join(', ')}`);
  }

  getName(): string {
    return 'resend';
  }
}