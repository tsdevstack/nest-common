import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError, lastValueFrom, catchError } from 'rxjs';

import { MetricsInterceptor } from './metrics.interceptor';
import type { MetricsService } from './metrics.service';

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor;
  let mockMetricsService: Partial<MetricsService>;
  let mockExecutionContext: ExecutionContext;
  let mockCallHandler: CallHandler;
  let mockRequest: Record<string, unknown>;
  let mockResponse: Record<string, unknown>;

  beforeEach(() => {
    rs.clearAllMocks();

    mockMetricsService = {
      incrementActiveConnections: rs.fn(),
      decrementActiveConnections: rs.fn(),
      recordHttpRequestDuration: rs.fn(),
      incrementHttpRequestTotal: rs.fn(),
    };

    mockRequest = {
      method: 'GET',
      url: '/api/test',
      route: { path: '/api/test' },
    };

    mockResponse = {
      statusCode: 200,
    };

    mockExecutionContext = {
      switchToHttp: rs.fn().mockReturnValue({
        getRequest: rs.fn().mockReturnValue(mockRequest),
        getResponse: rs.fn().mockReturnValue(mockResponse),
      }),
    } as unknown as ExecutionContext;

    mockCallHandler = {
      handle: rs.fn().mockReturnValue(of({})),
    };

    interceptor = new MetricsInterceptor(mockMetricsService as MetricsService);
  });

  describe('intercept', () => {
    it('should skip metrics for /metrics endpoint', async () => {
      mockRequest.url = '/metrics';

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(
        mockMetricsService.incrementActiveConnections,
      ).not.toHaveBeenCalled();
      expect(
        mockMetricsService.recordHttpRequestDuration,
      ).not.toHaveBeenCalled();
    });

    it('should increment active connections at start', async () => {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(
        mockMetricsService.incrementActiveConnections,
      ).toHaveBeenCalledTimes(1);
    });

    it('should decrement active connections on completion', async () => {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(
        mockMetricsService.decrementActiveConnections,
      ).toHaveBeenCalledTimes(1);
    });

    it('should record request duration on success', async () => {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockMetricsService.recordHttpRequestDuration).toHaveBeenCalledWith(
        { method: 'GET', route: '/api/test', status_code: '200' },
        expect.any(Number),
      );
    });

    it('should increment request total on success', async () => {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockMetricsService.incrementHttpRequestTotal).toHaveBeenCalledWith(
        {
          method: 'GET',
          route: '/api/test',
          status_code: '200',
        },
      );
    });

    it('should record metrics on error', async () => {
      const error = new Error('Test error');
      mockCallHandler.handle = rs.fn().mockReturnValue(throwError(() => error));
      mockResponse.statusCode = 500;

      await lastValueFrom(
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .pipe(catchError(() => of(null))),
      );

      expect(mockMetricsService.recordHttpRequestDuration).toHaveBeenCalledWith(
        { method: 'GET', route: '/api/test', status_code: '500' },
        expect.any(Number),
      );
      expect(mockMetricsService.incrementHttpRequestTotal).toHaveBeenCalledWith(
        {
          method: 'GET',
          route: '/api/test',
          status_code: '500',
        },
      );
    });

    it('should decrement active connections on error', async () => {
      const error = new Error('Test error');
      mockCallHandler.handle = rs.fn().mockReturnValue(throwError(() => error));

      await lastValueFrom(
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .pipe(catchError(() => of(null))),
      );

      expect(
        mockMetricsService.decrementActiveConnections,
      ).toHaveBeenCalledTimes(1);
    });

    it('should use url when route.path is not available', async () => {
      delete mockRequest.route;
      mockRequest.url = '/fallback-url';

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockMetricsService.recordHttpRequestDuration).toHaveBeenCalledWith(
        expect.objectContaining({ route: '/fallback-url' }),
        expect.any(Number),
      );
    });

    it('should handle different HTTP methods', async () => {
      mockRequest.method = 'POST';

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockMetricsService.incrementHttpRequestTotal).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should handle different status codes', async () => {
      mockResponse.statusCode = 404;

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockMetricsService.incrementHttpRequestTotal).toHaveBeenCalledWith(
        expect.objectContaining({ status_code: '404' }),
      );
    });

    it('should default to 500 status code when not set on error', async () => {
      const error = new Error('Test error');
      mockCallHandler.handle = rs.fn().mockReturnValue(throwError(() => error));
      mockResponse.statusCode = undefined;

      await lastValueFrom(
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .pipe(catchError(() => of(null))),
      );

      expect(mockMetricsService.incrementHttpRequestTotal).toHaveBeenCalledWith(
        expect.objectContaining({ status_code: '500' }),
      );
    });

    it('should record duration as a number in seconds', async () => {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      const [, duration] = (
        mockMetricsService.recordHttpRequestDuration as ReturnType<typeof rs.fn>
      ).mock.calls[0];
      expect(typeof duration).toBe('number');
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThan(1); // Should be much less than 1 second for a mock
    });
  });
});
