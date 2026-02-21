/**
 * Console Email Provider
 *
 * Logs emails to console instead of sending them.
 * Used for local development.
 */
import { Injectable } from '@nestjs/common';
import type { EmailOptions } from '../../interfaces/email-options.interface';
import type { EmailProvider } from '../email-provider.interface';
import { LoggerService } from '../../../logging/logger.service';

@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger: LoggerService;

  constructor(logger?: LoggerService) {
    this.logger = logger?.child('Email') ?? new LoggerService().child('Email');
  }

  async send(options: EmailOptions): Promise<void> {
    const recipients = Array.isArray(options.to) ? options.to.join(', ') : options.to;
    const content = options.html || options.text || '(no content)';

    // Use console.log directly for maximum visibility in development
    console.log('\n========================================');
    console.log('📧 EMAIL (console provider - not actually sent)');
    console.log('========================================');
    console.log(`To:      ${recipients}`);
    console.log(`Subject: ${options.subject}`);
    if (options.from) {
      console.log(`From:    ${options.from}`);
    }
    if (options.replyTo) {
      console.log(`Reply-To: ${options.replyTo}`);
    }
    console.log('----------------------------------------');
    console.log('Body:');
    console.log(content);
    console.log('========================================\n');

    // Also log through structured logger for consistency
    this.logger.info('Email sent via console provider', {
      to: recipients,
      subject: options.subject,
    });
  }

  getName(): string {
    return 'console';
  }
}
