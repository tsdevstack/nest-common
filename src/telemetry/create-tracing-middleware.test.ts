import { EventEmitter } from 'node:events';
import {
  describe,
  it,
  expect,
  rs,
  beforeAll,
  afterAll,
  beforeEach,
} from '@rstest/core';
import {
  SpanStatusCode,
  context,
  propagation,
  trace,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import type { NextFunction, Request, Response } from 'express';
import { createTracingMiddleware } from './create-tracing-middleware';

const TRACE_ID = '5759e988bd862e3fe1be46a994272793';

interface FakeResponse extends EventEmitter {
  statusCode: number;
  writableFinished: boolean;
}

function makeRequest(overrides: Record<string, unknown> = {}): Request {
  return {
    method: 'GET',
    originalUrl: '/auth/v1/users/42?x=1',
    path: '/auth/v1/users/42',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeResponse(): FakeResponse {
  const res = new EventEmitter() as FakeResponse;
  res.statusCode = 200;
  res.writableFinished = false;
  return res;
}

function finish(res: FakeResponse, statusCode: number): void {
  res.statusCode = statusCode;
  res.writableFinished = true;
  res.emit('finish');
  res.emit('close');
}

describe('createTracingMiddleware', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });

  beforeAll(() => {
    trace.setGlobalTracerProvider(provider);
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  afterAll(() => {
    trace.disable();
    context.disable();
    propagation.disable();
  });

  beforeEach(() => {
    exporter.reset();
  });

  describe('Standard use cases', () => {
    it("should run the request in a span that continues the caller's trace", () => {
      const middleware = createTracingMiddleware();
      const req = makeRequest({
        headers: {
          traceparent: `00-${TRACE_ID}-53995c3f42cd8ad8-01`,
        },
      });
      const res = makeResponse();
      let activeTraceId: string | undefined;
      const next = rs.fn(() => {
        activeTraceId = trace.getActiveSpan()?.spanContext().traceId;
      });

      middleware(req, res as unknown as Response, next as NextFunction);
      (req as unknown as { route: { path: string } }).route = {
        path: '/auth/v1/users/:id',
      };
      finish(res, 200);

      expect(next).toHaveBeenCalledTimes(1);
      expect(activeTraceId).toBe(TRACE_ID);
      const [span] = exporter.getFinishedSpans();
      expect(span.name).toBe('GET /auth/v1/users/:id');
      expect(span.spanContext().traceId).toBe(TRACE_ID);
      expect(span.parentSpanContext?.spanId).toBe('53995c3f42cd8ad8');
      expect(span.attributes).toMatchObject({
        'http.request.method': 'GET',
        'url.path': '/auth/v1/users/42',
        'http.route': '/auth/v1/users/:id',
        'http.response.status_code': 200,
      });
      expect(span.status.code).toBe(SpanStatusCode.UNSET);
    });

    it('should mark a server error, not a client error', () => {
      const middleware = createTracingMiddleware();

      const failed = makeResponse();
      middleware(makeRequest(), failed as unknown as Response, rs.fn());
      finish(failed, 500);
      const refused = makeResponse();
      middleware(makeRequest(), refused as unknown as Response, rs.fn());
      finish(refused, 401);

      const [serverError, clientError] = exporter.getFinishedSpans();
      expect(serverError.status).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'HTTP 500',
      });
      expect(clientError.status.code).toBe(SpanStatusCode.UNSET);
    });
  });

  describe('Edge cases', () => {
    it('should start a new trace without traceparent and name it by method without a route', () => {
      const middleware = createTracingMiddleware();
      const res = makeResponse();

      middleware(makeRequest(), res as unknown as Response, rs.fn());
      finish(res, 404);

      const [span] = exporter.getFinishedSpans();
      expect(span.name).toBe('GET');
      expect(span.parentSpanContext).toBeUndefined();
    });

    it('should not trace health checks and metrics scrapes', () => {
      const middleware = createTracingMiddleware();
      const next = rs.fn();

      for (const path of ['/health', '/health/ping', '/metrics']) {
        const res = makeResponse();
        middleware(
          makeRequest({ originalUrl: path, path }),
          res as unknown as Response,
          next,
        );
        finish(res, 200);
      }

      expect(next).toHaveBeenCalledTimes(3);
      expect(exporter.getFinishedSpans()).toHaveLength(0);
    });

    it('should end the span once, as failed, when the client goes away first', () => {
      const middleware = createTracingMiddleware();
      const res = makeResponse();

      middleware(makeRequest(), res as unknown as Response, rs.fn());
      res.emit('close');
      res.emit('close');

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
      expect(spans[0].attributes['http.response.status_code']).toBeUndefined();
    });
  });
});
