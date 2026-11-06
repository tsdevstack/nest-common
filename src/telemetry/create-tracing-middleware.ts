import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
} from '@opentelemetry/api';
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  ATTR_URL_PATH,
} from '@opentelemetry/semantic-conventions';
import { isQuietRequestPath } from '../logging/is-quiet-request-path';
import { TRACER_NAME } from './telemetry.constants';

/**
 * One server span per request, around everything Nest does with it (guards,
 * interceptors, the handler, the exception filter), so every log line of
 * the request carries its trace, the request line included. Continues the
 * trace a traceparent header brings (Kong, another service). Health checks
 * and metrics scrapes get no span.
 */
export function createTracingMiddleware(): RequestHandler {
  // A proxy until telemetry registers the provider (at module init)
  const tracer = trace.getTracer(TRACER_NAME);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (
      isQuietRequestPath(req.originalUrl) ||
      req.originalUrl.includes('/.well-known/')
    ) {
      next();
      return;
    }

    const parent = propagation.extract(ROOT_CONTEXT, req.headers);
    const span = tracer.startSpan(
      req.method,
      {
        kind: SpanKind.SERVER,
        attributes: {
          [ATTR_HTTP_REQUEST_METHOD]: req.method,
          // Path only: query strings can hold personal data
          [ATTR_URL_PATH]: req.path,
        },
      },
      parent,
    );

    let ended = false;
    const end = (statusCode: number | undefined): void => {
      if (ended) {
        return;
      }
      ended = true;
      // The route pattern (/auth/v1/users/:id), set once Express matched it
      const route: unknown = req.route?.path;
      if (typeof route === 'string') {
        span.setAttribute(ATTR_HTTP_ROUTE, route);
        span.updateName(`${req.method} ${route}`);
      }
      if (statusCode === undefined) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'The connection closed before the response was sent',
        });
      } else {
        span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, statusCode);
        // Client errors (4xx) are answers, not failures of the service
        if (statusCode >= 500) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${statusCode}`,
          });
        }
      }
      span.end();
    };

    res.once('finish', () => end(res.statusCode));
    res.once('close', () =>
      end(res.writableFinished ? res.statusCode : undefined),
    );

    context.with(trace.setSpan(parent, span), next);
  };
}
