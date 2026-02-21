import { SetMetadata } from "@nestjs/common";

export interface EmailRateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  message?: string;
  emailField?: string; // Field name in request body (default: 'email')
}

export const EMAIL_RATE_LIMIT_KEY = "emailRateLimit";

export const EmailRateLimitDecorator = (options: EmailRateLimitOptions) =>
  SetMetadata(EMAIL_RATE_LIMIT_KEY, options);
