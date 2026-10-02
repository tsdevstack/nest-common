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

    const { method, url, ip } = request;

    // Health probes and metrics scrapes are not logged (they keep the
    // correlation ID)
    if (isQuietRequestPath(url)) {
      return next.handle();
    }

    const userAgent = request.get('user-agent') || '';
    const startTime = Date.now();
    // Set by AuthGuard (guards run before interceptors); never the raw key
    const keyContext = this.getApiKeyContext(request);

    // Log incoming request (debug level to reduce noise)
    this.logger.debug('Incoming request', {
      method,
      url,
      ip,
      userAgent,
      ...keyContext,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;

          this.logger.info('Request completed', {
            method,
            url,
            statusCode,
            duration,
            ...keyContext,
          });
        },
        error: (error: Error) => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode || 500;

          this.logger.error('Request failed', error, {
            method,
            url,
            statusCode,
            duration,
            ...keyContext,
          });
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
