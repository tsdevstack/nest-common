import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError, lastValueFrom, catchError } from 'rxjs';

import { LoggingInterceptor } from './logging.interceptor';
import type { LoggerService } from './logger.service';

// Mock crypto.randomUUID
rs.stubGlobal('crypto', {
  randomUUID: rs.fn().mockReturnValue('test-uuid-123'),
});

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let mockLogger: Partial<LoggerService>;
  let mockChildLogger: Partial<LoggerService>;
  let mockExecutionContext: ExecutionContext;
  let mockCallHandler: CallHandler;
  let mockRequest: Record<string, unknown>;
  let mockResponse: {
    statusCode: number;
    setHeader: ReturnType<typeof rs.fn>;
  };

  beforeEach(() => {
    rs.clearAllMocks();

    mockChildLogger = {
      debug: rs.fn(),
      info: rs.fn(),
      error: rs.fn(),
    };

    mockLogger = {
      child: rs.fn().mockReturnValue(mockChildLogger),
    };

    mockRequest = {
      method: 'GET',
      url: '/api/test',
      ip: '127.0.0.1',
      headers: {},
      get: rs.fn().mockReturnValue('Mozilla/5.0'),
    };

    mockResponse = {
      statusCode: 200,
      setHeader: rs.fn(),
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

    interceptor = new LoggingInterceptor(mockLogger as LoggerService);
  });

  describe('constructor', () => {
    it('should create child logger with HTTP context', () => {
      expect(mockLogger.child).toHaveBeenCalledWith('HTTP');
    });
  });

  describe('intercept', () => {
    it('should use x-request-id header for correlation ID', async () => {
      mockRequest.headers = { 'x-request-id': 'kong-request-id' };

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-Correlation-ID',
        'kong-request-id',
      );
    });

    it('should use x-correlation-id header as fallback', async () => {
      mockRequest.headers = { 'x-correlation-id': 'correlation-id' };

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-Correlation-ID',
        'correlation-id',
      );
    });

    it('should generate UUID when no correlation ID headers present', async () => {
      mockRequest.headers = {};

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-Correlation-ID',
        'test-uuid-123',
      );
    });

    it('should store correlation ID on request object', async () => {
      mockRequest.headers = { 'x-request-id': 'test-id' };

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockRequest.correlationId).toBe('test-id');
    });

    it('should log incoming request at debug level', async () => {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockChildLogger.debug).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          method: 'GET',
          url: '/api/test',
          ip: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
        }),
      );
    });

    it('should log request completed at info level on success', async () => {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          method: 'GET',
          url: '/api/test',
          statusCode: 200,
          duration: expect.any(Number),
        }),
      );
    });

    it('should log request failed at error level on error', async () => {
      const error = new Error('Test error');
      mockCallHandler.handle = rs.fn().mockReturnValue(throwError(() => error));
      mockResponse.statusCode = 500;

      await lastValueFrom(
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .pipe(catchError(() => of(null))),
      );

      expect(mockChildLogger.error).toHaveBeenCalledWith(
        'Request failed',
        error,
        expect.objectContaining({
          method: 'GET',
          url: '/api/test',
          statusCode: 500,
          duration: expect.any(Number),
        }),
      );
    });

    it('should default to 500 status code on error when not set', async () => {
      const error = new Error('Test error');
      mockCallHandler.handle = rs.fn().mockReturnValue(throwError(() => error));
      mockResponse.statusCode = 0; // Falsy value

      await lastValueFrom(
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .pipe(catchError(() => of(null))),
      );

      expect(mockChildLogger.error).toHaveBeenCalledWith(
        'Request failed',
        error,
        expect.objectContaining({
          statusCode: 500,
        }),
      );
    });

    it('should handle empty user agent', async () => {
      (mockRequest.get as ReturnType<typeof rs.fn>).mockReturnValue('');

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockChildLogger.debug).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          userAgent: '',
        }),
      );
    });

    it('should handle undefined user agent', async () => {
      (mockRequest.get as ReturnType<typeof rs.fn>).mockReturnValue(undefined);

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockChildLogger.debug).toHaveBeenCalledWith(
        'Incoming request',
        expect.objectContaining({
          userAgent: '',
        }),
      );
    });

    it('should include duration in milliseconds', async () => {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      const [, context] = (mockChildLogger.info as ReturnType<typeof rs.fn>)
        .mock.calls[0];
      expect(context.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle different HTTP methods', async () => {
      mockRequest.method = 'POST';

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        'Request completed',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should prefer x-request-id over x-correlation-id', async () => {
      mockRequest.headers = {
        'x-request-id': 'request-id',
        'x-correlation-id': 'correlation-id',
      };

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-Correlation-ID',
        'request-id',
      );
    });
  });
});
