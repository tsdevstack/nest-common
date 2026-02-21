import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Response } from 'express';

interface RequestWithRateLimit {
  rateLimit?: {
    limit: number;
    remaining: number;
    reset: number;
  };
}

@Injectable()
export class RateLimitHeadersInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap(() => {
        const request = context
          .switchToHttp()
          .getRequest<RequestWithRateLimit>();
        const response = context.switchToHttp().getResponse<Response>();

        // Add rate limit headers if rate limit data exists
        if (request.rateLimit) {
          response.setHeader(
            'X-RateLimit-Limit',
            request.rateLimit.limit.toString(),
          );
          response.setHeader(
            'X-RateLimit-Remaining',
            request.rateLimit.remaining.toString(),
          );
          response.setHeader(
            'X-RateLimit-Reset',
            request.rateLimit.reset.toString(),
          );
        }
      }),
    );
  }
}
