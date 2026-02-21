import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Skip metrics endpoint itself to avoid circular metrics
    if (request.url.includes('/metrics')) {
      return next.handle();
    }

    const { method } = request;
    // Get the route pattern from the controller/handler metadata
    const route = request.route?.path || request.url;
    const startTime = process.hrtime.bigint();

    // Increment active connections
    this.metricsService.incrementActiveConnections();

    return next.handle().pipe(
      tap({
        next: () => {
          this.recordMetrics(method, route, response.statusCode, startTime);
        },
        error: () => {
          this.recordMetrics(method, route, response.statusCode || 500, startTime);
        },
        finalize: () => {
          // Decrement active connections when request completes
          this.metricsService.decrementActiveConnections();
        },
      }),
    );
  }

  private recordMetrics(
    method: string,
    route: string,
    statusCode: number,
    startTime: bigint,
  ): void {
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9; // Convert to seconds
    const labels = { method, route, status_code: String(statusCode) };

    this.metricsService.recordHttpRequestDuration(labels, duration);
    this.metricsService.incrementHttpRequestTotal(labels);
  }
}