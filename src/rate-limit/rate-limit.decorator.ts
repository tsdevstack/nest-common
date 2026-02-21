import { SetMetadata, ExecutionContext } from '@nestjs/common';

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: 'ip' | 'apiKey' | 'userId' | 'custom';
  customKeyGenerator?: (context: ExecutionContext) => string;
  skipIf?: (context: ExecutionContext) => boolean;
  message?: string;
}

export const RATE_LIMIT_KEY = 'rateLimit';

export const RateLimitDecorator = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);
