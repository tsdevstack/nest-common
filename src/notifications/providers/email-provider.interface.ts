/**
 * Email Provider Interface
 *
 * All email providers (Console, Resend) must implement this interface.
 */
import type { EmailOptions } from '../interfaces/email-options.interface';

export interface EmailProvider {
  /**
   * Send an email
   * @param options - Email options (to, subject, html/text, etc.)
   */
  send(options: EmailOptions): Promise<void>;

  /**
   * Get the provider name (for logging/debugging)
   */
  getName(): string;
}
