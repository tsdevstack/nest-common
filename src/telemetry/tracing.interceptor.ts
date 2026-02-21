import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import {
  trace,
  context as otelContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  type Span,
} from '@opentelemetry/api';
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_URL_PATH,
  ATTR_HTTP_ROUTE,
} from '@opentelemetry/semantic-conventions';
import { TelemetryService } from './telemetry.service';

@Injectable()
export class TracingInterceptor implements NestInterceptor {
  constructor(private readonly telemetryService: TelemetryService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Skip if tracing is disabled
    if (!this.telemetryService.isTracingEnabled()) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Skip tracing for infrastructure endpoints
    if (this.isInfrastructureEndpoint(request.url)) {
      return next.handle();
    }

    // Extract trace context from incoming headers (W3C traceparent)
    const parentContext = propagation.extract(
      otelContext.active(),
      request.headers,
    );

    const { method } = request;
    const route = request.route?.path || request.url;
    const tracer = this.telemetryService.getTracer();

    // Create span within parent context
    return otelContext.with(parentContext, () => {
      const span = tracer.startSpan(
        `${method} ${route}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            [ATTR_HTTP_REQUEST_METHOD]: method,
            [ATTR_URL_PATH]: request.url,
            [ATTR_HTTP_ROUTE]: route,
          },
        },
        parentContext,
      );

      // Set span in context for downstream access
      const spanContext = trace.setSpan(otelContext.active(), span);

      return otelContext.with(spanContext, () => {
        return next.handle().pipe(
          tap({
            next: () => {
              this.finishSpan(span, response.statusCode);
            },
            error: (error: Error) => {
              this.finishSpanWithError(span, response.statusCode || 500, error);
            },
          }),
        );
      });
    });
  }

  private isInfrastructureEndpoint(url: string): boolean {
    return (
      url === '/health' ||
      url.startsWith('/health/') ||
      url === '/metrics' ||
      url.includes('/.well-known/')
    );
  }

  private finishSpan(span: Span, statusCode: number): void {
    span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, statusCode);

    if (statusCode >= 400) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP ${statusCode}`,
      });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
  }

  private finishSpanWithError(
    span: Span,
    statusCode: number,
    error: Error,
  ): void {
    span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, statusCode);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    span.recordException(error);
    span.end();
  }
}