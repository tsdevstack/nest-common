import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { LoggerService } from './logger.service';
import { isQuietRequestPath } from './is-quiet-request-path';
import { getErrorStatus } from './get-error-status';
import { markRequestLoggedError } from './mark-request-logged-error';
import type {
  AuthenticatedApiKey,
  AuthType,
} from '../auth/auth-user.interface';

interface RequestWithCorrelation extends Request {
  correlationId?: string;
  authType?: AuthType;
  apiKey?: AuthenticatedApiKey;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger.child('HTTP');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithCorrelation>();
    const response = context.switchToHttp().getResponse<Response>();

    // Get correlation ID from Kong's X-Request-ID header or generate one
    const correlationId =
      (request.headers['x-request-id'] as string) ||
      (request.headers['x-correlation-id'] as string) ||
      crypto.randomUUID();

    // Store correlation ID on request for other services to use
    request.correlationId = correlationId;

    // Add correlation ID to response headers (trace_id from OTEL handles log correlation)
    response.setHeader('X-Correlation-ID', correlationId);

    const { method, url } = request;
    // Health probes and metrics scrapes hit every service every few seconds:
    // logged at debug, failures at warn
    const quiet = isQuietRequestPath(url);
    const startTime = Date.now();
    // Set by AuthGuard (guards run before interceptors); never the raw key
    const keyContext = this.getApiKeyContext(request);

    // One entry per request, written when it ends. The request fields are
    // grouped under http (hidden in the local pretty output, where the
    // message already says them).
    const entry = (statusCode: number) => {
      const duration = Date.now() - startTime;
      return {
        message: `${method} ${url} ${statusCode} ${duration}ms`,
        fields: {
          http: { method, url, statusCode, duration },
          correlationId,
          ...keyContext,
        },
      };
    };

    return next.handle().pipe(
      tap({
        next: () => {
          // Nest sets the status (200, 201, @HttpCode) before interceptors run
          const { message, fields } = entry(response.statusCode);
          if (quiet) {
            this.logger.debug(message, fields);
          } else {
            this.logger.info(message, fields);
          }
        },
        error: (error: unknown) => {
          // The exception filter has not set the response status yet
          const { message, fields } = entry(getErrorStatus(error));
          const reason = error instanceof Error ? error.message : String(error);
          // Nest's exception handler would log an unknown error a second time
          markRequestLoggedError(error);

          if (quiet) {
            this.logger.warn(message, { ...fields, reason });
          } else if (fields.http.statusCode >= 500) {
            this.logger.error(message, error, fields);
          } else {
            // Client errors (validation, auth, unknown id) are expected
            // answers: no stack trace, below error level
            this.logger.warn(message, { ...fields, reason });
          }
        },
      }),
    );
  }

  /**
   * Log fields identifying the partner API key of a request.
   */
  private getApiKeyContext(
    request: RequestWithCorrelation,
  ): { apiKeyId: string; apiKeyConsumer: string } | Record<string, never> {
    if (request.authType !== 'apiKey' || !request.apiKey) {
      return {};
    }
    return {
      apiKeyId: request.apiKey.id,
      apiKeyConsumer: request.apiKey.consumer,
    };
  }
}
