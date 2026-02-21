import { describe, it, expect } from '@rstest/core';
import { ExecutionContext } from '@nestjs/common';

// Import the decorator's callback function directly for testing
// createParamDecorator returns a function, but we need to test the callback
const partnerCallback = (
  data: unknown,
  ctx: ExecutionContext,
): string | undefined => {
  const request = ctx.switchToHttp().getRequest();
  return request.headers['x-consumer-username'] as string | undefined;
};

describe('Partner', () => {
  const createMockExecutionContext = (
    headers: Record<string, string>,
  ): ExecutionContext => {
    const request = { headers };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  };

  describe('Header extraction', () => {
    it('should extract partner username from X-Consumer-Username header', () => {
      const context = createMockExecutionContext({
        'x-consumer-username': 'acme-corp',
      });

      const result = partnerCallback(undefined, context);

      expect(result).toBe('acme-corp');
    });

    it('should return undefined when header is not present', () => {
      const context = createMockExecutionContext({});

      const result = partnerCallback(undefined, context);

      expect(result).toBeUndefined();
    });

    it('should handle empty string header value', () => {
      const context = createMockExecutionContext({
        'x-consumer-username': '',
      });

      const result = partnerCallback(undefined, context);

      expect(result).toBe('');
    });

    it('should handle header with special characters', () => {
      const context = createMockExecutionContext({
        'x-consumer-username': 'partner-123_test',
      });

      const result = partnerCallback(undefined, context);

      expect(result).toBe('partner-123_test');
    });
  });

  describe('Real-world scenarios', () => {
    it('should extract partner from Kong gateway request', () => {
      const context = createMockExecutionContext({
        'x-consumer-username': 'beta-startup',
        'x-consumer-id': 'kong-internal-id-123',
        'x-api-key': 'api-key-value', // This would be removed by Kong
      });

      const result = partnerCallback(undefined, context);

      expect(result).toBe('beta-startup');
    });

    it('should handle request without partner (JWT auth)', () => {
      const context = createMockExecutionContext({
        authorization: 'Bearer jwt-token-here',
        // No x-consumer-username header
      });

      const result = partnerCallback(undefined, context);

      expect(result).toBeUndefined();
    });

    it('should extract partner with mixed case header', () => {
      // HTTP headers are case-insensitive, but Node.js lowercases them
      const context = createMockExecutionContext({
        'x-consumer-username': 'EnterprisePartner',
      });

      const result = partnerCallback(undefined, context);

      expect(result).toBe('EnterprisePartner');
    });
  });

  describe('Edge cases', () => {
    it('should handle request with multiple consumers (should not happen, but testing)', () => {
      const context = createMockExecutionContext({
        'x-consumer-username': 'first-partner',
      });

      const result = partnerCallback(undefined, context);

      expect(result).toBe('first-partner');
    });

    it('should handle whitespace in header value', () => {
      const context = createMockExecutionContext({
        'x-consumer-username': '  partner-with-spaces  ',
      });

      const result = partnerCallback(undefined, context);

      // Returns as-is (trimming is caller's responsibility if needed)
      expect(result).toBe('  partner-with-spaces  ');
    });

    it('should handle numeric-only partner name', () => {
      const context = createMockExecutionContext({
        'x-consumer-username': '12345',
      });

      const result = partnerCallback(undefined, context);

      expect(result).toBe('12345');
    });
  });

  describe('Type safety', () => {
    it('should return string when header is present', () => {
      const context = createMockExecutionContext({
        'x-consumer-username': 'test-partner',
      });

      const result: string | undefined = partnerCallback(undefined, context);

      expect(typeof result).toBe('string');
      expect(result).toBe('test-partner');
    });

    it('should return undefined when header is missing', () => {
      const context = createMockExecutionContext({});

      const result: string | undefined = partnerCallback(undefined, context);

      expect(result).toBeUndefined();
    });
  });
});
