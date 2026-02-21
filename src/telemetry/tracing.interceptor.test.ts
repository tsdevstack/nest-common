import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError, lastValueFrom, catchError } from 'rxjs';

// Use rs.hoisted() to define mocks that can be used in rs.mock() factories
const { mockSpan, mockTracer, mockContext } = rs.hoisted(() => ({
  mockSpan: {
    setAttribute: rs.fn(),
    setStatus: rs.fn(),
    recordException: rs.fn(),
    end: rs.fn(),
  },
  mockTracer: {
    startSpan: rs.fn(),
  },
  mockContext: {
    active: rs.fn().mockReturnValue({}),
    with: rs
      .fn()
      .mockImplementation((_ctx: unknown, fn: () => unknown) => fn()),
  },
}));

// Set up mockTracer to return mockSpan
mockTracer.startSpan.mockReturnValue(mockSpan);

rs.mock('@opentelemetry/api', () => ({
  trace: {
    setSpan: rs.fn().mockReturnValue({}),
  },
  context: mockContext,
  propagation: {
    extract: rs.fn().mockReturnValue({}),
  },
  SpanKind: {
    SERVER: 1,
  },
  SpanStatusCode: {
    OK: 1,
    ERROR: 2,
  },
}));

rs.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_HTTP_REQUEST_METHOD: 'http.request.method',
  ATTR_HTTP_RESPONSE_STATUS_CODE: 'http.response.status_code',
  ATTR_URL_PATH: 'url.path',
  ATTR_HTTP_ROUTE: 'http.route',
}));

import { TracingInterceptor } from './tracing.interceptor';
import type { TelemetryService } from './telemetry.service';

describe('TracingInterceptor', () => {
  let interceptor: TracingInterceptor;
  let mockTelemetryService: Partial<TelemetryService>;
  let mockExecutionContext: ExecutionContext;
  let mockCallHandler: CallHandler;
  let mockRequest: Record<string, unknown>;
  let mockResponse: Record<string, unknown>;

  beforeEach(() => {
    rs.clearAllMocks();

    mockTelemetryService = {
      isTracingEnabled: rs.fn().mockReturnValue(true),
      getTracer: rs.fn().mockReturnValue(mockTracer),
    };

    mockRequest = {
      method: 'GET',
      url: '/api/test',
      route: { path: '/api/test' },
      headers: {},
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

    interceptor = new TracingInterceptor(
      mockTelemetryService as TelemetryService,
    );
  });

  describe('intercept', () => {
    it('should skip tracing when disabled', async () => {
      (
        mockTelemetryService.isTracingEnabled as ReturnType<typeof rs.fn>
      ).mockReturnValue(false);

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockTracer.startSpan).not.toHaveBeenCalled();
    });

    it('should skip tracing for /health endpoint', async () => {
      mockRequest.url = '/health';

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockTracer.startSpan).not.toHaveBeenCalled();
    });

    it('should skip tracing for /health/* endpoints', async () => {
      mockRequest.url = '/health/ping';

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockTracer.startSpan).not.toHaveBeenCalled();
    });

    it('should skip tracing for /metrics endpoint', async () => {
      mockRequest.url = '/metrics';

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockTracer.startSpan).not.toHaveBeenCalled();
    });

    it('should skip tracing for /.well-known/* endpoints', async () => {
      mockRequest.url = '/.well-known/jwks.json';

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockTracer.startSpan).not.toHaveBeenCalled();
    });

    it('should create span for normal requests', async () => {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'GET /api/test',
        expect.objectContaining({
          kind: 1, // SpanKind.SERVER
          attributes: expect.objectContaining({
            'http.request.method': 'GET',
            'url.path': '/api/test',
          }),
        }),
        expect.anything(),
      );
    });

    it('should set status code attribute on successful response', async () => {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'http.response.status_code',
        200,
      );
    });

    it('should set OK status for 2xx responses', async () => {
      mockResponse.statusCode = 200;

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // SpanStatusCode.OK
    });

    it('should set OK status for 3xx responses', async () => {
      mockResponse.statusCode = 302;

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // SpanStatusCode.OK
    });

    it('should set ERROR status for 4xx responses', async () => {
      mockResponse.statusCode = 400;

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: 2, // SpanStatusCode.ERROR
        message: 'HTTP 400',
      });
    });

    it('should set ERROR status for 5xx responses', async () => {
      mockResponse.statusCode = 500;

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: 2, // SpanStatusCode.ERROR
        message: 'HTTP 500',
      });
    });

    it('should end span after successful response', async () => {
      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle errors and record exception', async () => {
      const error = new Error('Test error');
      mockCallHandler.handle = rs.fn().mockReturnValue(throwError(() => error));
      mockResponse.statusCode = 500;

      await lastValueFrom(
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .pipe(catchError(() => of(null))),
      );

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: 2, // SpanStatusCode.ERROR
        message: 'Test error',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should use url when route.path is not available', async () => {
      delete mockRequest.route;
      mockRequest.url = '/fallback-url';

      await lastValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      );

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'GET /fallback-url',
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
