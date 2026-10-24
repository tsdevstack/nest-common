import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import {
  ExecutionContext,
  CallHandler,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
      warn: rs.fn(),
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

  describe('correlation ID', () => {
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

    it('should store correlation ID on request object', async () => {
      mockRequest.headers = { 'x-request-id': 'test-id' };

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockRequest.correlationId).toBe('test-id');
    });
  });

  describe('successful requests', () => {
    it('should log one info entry per request when it ends', async () => {
      mockRequest.headers = { 'x-request-id': 'req-1' };

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockChildLogger.debug).not.toHaveBeenCalled();
      expect(mockChildLogger.info).toHaveBeenCalledTimes(1);
      expect(mockChildLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/^GET \/api\/test 200 \d+ms$/),
        {
          http: {
            method: 'GET',
            url: '/api/test',
            statusCode: 200,
            duration: expect.any(Number),
          },
          correlationId: 'req-1',
        },
      );
    });

    it('should use the status Nest set before the handler ran', async () => {
      mockRequest.method = 'POST';
      mockResponse.statusCode = 201;

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/^POST \/api\/test 201 \d+ms$/),
        expect.objectContaining({
          http: expect.objectContaining({ method: 'POST', statusCode: 201 }),
        }),
      );
    });

    it('should include the duration in milliseconds', async () => {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      const [, fields] = rs.mocked(mockChildLogger.info!).mock.calls[0] as [
        string,
        { http: { duration: number } },
      ];
      expect(fields.http.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('failed requests', () => {
    it('should log an unknown error as 500 at error level with the error', async () => {
      const error = new Error('Test error');
      mockCallHandler.handle = rs.fn().mockReturnValue(throwError(() => error));
      // The exception filter sets the status after the interceptor runs
      mockResponse.statusCode = 200;

      await lastValueFrom(
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .pipe(catchError(() => of(null))),
      );

      expect(mockChildLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(/^GET \/api\/test 500 \d+ms$/),
        error,
        expect.objectContaining({
          http: expect.objectContaining({ statusCode: 500 }),
        }),
      );
      expect(mockChildLogger.info).not.toHaveBeenCalled();
    });

    it('should log a server error from an HttpException at error level with its status', async () => {
      const error = new ServiceUnavailableException();
      mockCallHandler.handle = rs.fn().mockReturnValue(throwError(() => error));

      await lastValueFrom(
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .pipe(catchError(() => of(null))),
      );

      expect(mockChildLogger.warn).not.toHaveBeenCalled();
      expect(mockChildLogger.error).toHaveBeenCalledWith(
        expect.stringMatching(/ 503 /),
        error,
        expect.objectContaining({
          http: expect.objectContaining({ statusCode: 503 }),
        }),
      );
    });

    it('should log a client error at warn level with its status and reason, no stack', async () => {
      mockRequest.headers = { 'x-request-id': 'req-2' };
      const error = new NotFoundException('Avatar not found');
      mockCallHandler.handle = rs.fn().mockReturnValue(throwError(() => error));

      await lastValueFrom(
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .pipe(catchError(() => of(null))),
      );

      expect(mockChildLogger.error).not.toHaveBeenCalled();
      expect(mockChildLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/^GET \/api\/test 404 \d+ms$/),
        {
          http: {
            method: 'GET',
            url: '/api/test',
            statusCode: 404,
            duration: expect.any(Number),
          },
          correlationId: 'req-2',
          reason: 'Avatar not found',
        },
      );
    });

    it('should pass the error through to the exception filter', async () => {
      const error = new NotFoundException();
      mockCallHandler.handle = rs.fn().mockReturnValue(throwError(() => error));

      await expect(
        lastValueFrom(
          interceptor.intercept(mockExecutionContext, mockCallHandler),
        ),
      ).rejects.toBe(error);
    });
  });

  describe('health probes and metrics scrapes', () => {
    it('should log them at debug, keeping the correlation ID', async () => {
      mockRequest.headers = { 'x-request-id': 'scrape-id' };
      mockRequest.url = '/metrics';

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-Correlation-ID',
        'scrape-id',
      );
      expect(mockChildLogger.info).not.toHaveBeenCalled();
      expect(mockChildLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/^GET \/metrics 200 \d+ms$/),
        expect.objectContaining({ correlationId: 'scrape-id' }),
      );
    });

    it('should log a failing health check at warn, not error', async () => {
      mockRequest.url = '/health';
      const error = new ServiceUnavailableException('Redis is down');
      mockCallHandler.handle = rs.fn().mockReturnValue(throwError(() => error));

      await lastValueFrom(
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .pipe(catchError(() => of(null))),
      );

      expect(mockChildLogger.error).not.toHaveBeenCalled();
      expect(mockChildLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/^GET \/health 503 \d+ms$/),
        expect.objectContaining({ reason: 'Redis is down' }),
      );
    });
  });

  describe('partner API keys', () => {
    it('should log the API key id and consumer, never the raw key', async () => {
      mockRequest.authType = 'apiKey';
      mockRequest.apiKey = { id: 'key-1', consumer: 'acme-corp' };
      mockRequest.headers = { 'x-api-key': 'tsk_raw-secret' };

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockChildLogger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          apiKeyId: 'key-1',
          apiKeyConsumer: 'acme-corp',
        }),
      );
      const logged = JSON.stringify(
        rs.mocked(mockChildLogger.info!).mock.calls,
      );
      expect(logged).not.toContain('tsk_raw-secret');
    });

    it('should log the API key on failed partner requests', async () => {
      mockRequest.authType = 'apiKey';
      mockRequest.apiKey = { id: 'key-1', consumer: 'acme-corp' };
      const error = new Error('Test error');
      mockCallHandler.handle = rs.fn().mockReturnValue(throwError(() => error));

      await lastValueFrom(
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .pipe(catchError(() => of(null))),
      );

      expect(mockChildLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        error,
        expect.objectContaining({
          apiKeyId: 'key-1',
          apiKeyConsumer: 'acme-corp',
        }),
      );
    });

    it('should not add API key fields for other requests', async () => {
      mockRequest.authType = 'user';
      mockRequest.user = { id: 'user-1' };

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      const [, fields] = rs.mocked(mockChildLogger.info!).mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(fields).not.toHaveProperty('apiKeyId');
      expect(fields).not.toHaveProperty('apiKeyConsumer');
    });
  });
});
