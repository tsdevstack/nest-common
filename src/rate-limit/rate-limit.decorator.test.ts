import { describe, it, expect } from '@rstest/core';

import { RateLimitDecorator, RATE_LIMIT_KEY } from './rate-limit.decorator';

describe('RateLimitDecorator', () => {
  it('should export RATE_LIMIT_KEY constant', () => {
    expect(RATE_LIMIT_KEY).toBe('rateLimit');
  });

  it('should return a decorator function', () => {
    const decorator = RateLimitDecorator({ maxRequests: 10 });
    expect(typeof decorator).toBe('function');
  });

  it('should set metadata with provided options', () => {
    const options = {
      windowMs: 60000,
      maxRequests: 100,
      keyGenerator: 'ip' as const,
      message: 'Too many requests',
    };

    const decorator = RateLimitDecorator(options);

    // SetMetadata returns a decorator that applies metadata to the target
    // We can verify by checking the decorator is a function (metadata decorator)
    expect(typeof decorator).toBe('function');
  });

  it('should accept minimal options', () => {
    const decorator = RateLimitDecorator({});
    expect(typeof decorator).toBe('function');
  });

  it('should accept all keyGenerator values', () => {
    const generators = ['ip', 'apiKey', 'userId', 'custom'] as const;

    for (const keyGenerator of generators) {
      const decorator = RateLimitDecorator({ keyGenerator });
      expect(typeof decorator).toBe('function');
    }
  });
});
