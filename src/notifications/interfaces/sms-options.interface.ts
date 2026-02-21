/**
 * SMS Options Interface (Stub)
 *
 * Options for sending SMS via NotificationService.sendSMS()
 * Note: SMS support is not implemented in v1.
 */
export interface SMSOptions {
  /** Recipient phone number */
  to: string;

  /** Message body */
  body: string;
}
