/**
 * Push Notification Options Interface (Stub)
 *
 * Options for sending push notifications via NotificationService.sendPush()
 * Note: Push notification support is not implemented in v1.
 */
export interface PushOptions {
  /** Device tokens to send notification to */
  tokens: string[];

  /** Notification title */
  title: string;

  /** Notification body */
  body: string;

  /** Additional data payload */
  data?: Record<string, unknown>;
}
