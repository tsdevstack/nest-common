import { describe, it, expect } from '@rstest/core';

import {
  EmailRateLimitDecorator,
  EMAIL_RATE_LIMIT_KEY,
} from './email-rate-limit.decorator';

describe('EmailRateLimitDecorator', () => {
  it('should export EMAIL_RATE_LIMIT_KEY constant', () => {
    expect(EMAIL_RATE_LIMIT_KEY).toBe('emailRateLimit');
  });

  it('should return a decorator function', () => {
    const decorator = EmailRateLimitDecorator({ maxRequests: 5 });
    expect(typeof decorator).toBe('function');
  });

  it('should accept all options', () => {
    const decorator = EmailRateLimitDecorator({
      windowMs: 60000,
      maxRequests: 3,
      message: 'Too many emails',
      emailField: 'userEmail',
    });
    expect(typeof decorator).toBe('function');
  });

  it('should accept empty options', () => {
    const decorator = EmailRateLimitDecorator({});
    expect(typeof decorator).toBe('function');
  });
});
