/**
 * Email Options Interface
 *
 * Options for sending an email via NotificationService.sendEmail()
 */
export interface EmailOptions {
  /** Recipient email address(es) */
  to: string | string[];

  /** Email subject line */
  subject: string;

  /** HTML content of the email */
  html?: string;

  /** Plain text content (fallback if html not provided) */
  text?: string;

  /** Template name (for future template support) */
  template?: string;

  /** Data to pass to template (for future template support) */
  data?: Record<string, unknown>;

  /** From address (overrides default) */
  from?: string;

  /** Reply-to address */
  replyTo?: string;
}
