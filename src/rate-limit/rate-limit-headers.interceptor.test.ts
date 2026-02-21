import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';

import { RateLimitHeadersInterceptor } from './rate-limit-headers.interceptor';

describe('RateLimitHeadersInterceptor', () => {
  let interceptor: RateLimitHeadersInterceptor;
  let mockCallHandler: CallHandler;
  let mockRequest: Record<string, unknown>;
  let mockResponse: { setHeader: ReturnType<typeof rs.fn> };
  let mockExecutionContext: ExecutionContext;

  beforeEach(() => {
    rs.clearAllMocks();

    interceptor = new RateLimitHeadersInterceptor();

    mockRequest = {};
    mockResponse = {
      setHeader: rs.fn(),
    };

    mockExecutionContext = {
      switchToHttp: rs.fn().mockReturnValue({
        getRequest: rs.fn().mockReturnValue(mockRequest),
        getResponse: rs.fn().mockReturnValue(mockResponse),
      }),
    } as unknown as ExecutionContext;

    mockCallHandler = {
      handle: rs.fn().mockReturnValue(of({ data: 'test' })),
    };
  });

  describe('With rate limit data', () => {
    it('should set X-RateLimit-Limit header', async () => {
      mockRequest.rateLimit = { limit: 100, remaining: 99, reset: 1700000000 };

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Limit',
        '100',
      );
    });

    it('should set X-RateLimit-Remaining header', async () => {
      mockRequest.rateLimit = { limit: 100, remaining: 42, reset: 1700000000 };

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Remaining',
        '42',
      );
    });

    it('should set X-RateLimit-Reset header', async () => {
      mockRequest.rateLimit = { limit: 100, remaining: 99, reset: 1700000000 };

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Reset',
        '1700000000',
      );
    });

    it('should set all three headers', async () => {
      mockRequest.rateLimit = { limit: 50, remaining: 0, reset: 1700000000 };

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockResponse.setHeader).toHaveBeenCalledTimes(3);
    });
  });

  describe('Without rate limit data', () => {
    it('should not set any headers when rateLimit is undefined', async () => {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockResponse.setHeader).not.toHaveBeenCalled();
    });
  });

  describe('Response passthrough', () => {
    it('should pass through the response data', async () => {
      const result = await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(result).toEqual({ data: 'test' });
    });
  });
});
