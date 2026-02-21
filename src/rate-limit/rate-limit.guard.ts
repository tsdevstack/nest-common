import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { RedisService } from "../redis/redis.service";
import { RATE_LIMIT_KEY, RateLimitOptions } from "./rate-limit.decorator";

interface RequestWithRateLimit extends Request {
  rateLimit?: {
    limit: number;
    remaining: number;
    reset: number;
  };
  user?: {
    id?: string;
    sub?: string;
  };
}

interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  current: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rateLimitOptions = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!rateLimitOptions) {
      return true; // No rate limiting applied
    }

    if (rateLimitOptions.skipIf && rateLimitOptions.skipIf(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithRateLimit>();
    const result = await this.checkRateLimit(context, rateLimitOptions);

    if (!result.success) {
      const message = rateLimitOptions.message || "Too many requests";

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message,
          error: "Too Many Requests",
          limit: result.limit,
          remaining: result.remaining,
          reset: result.reset,
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    // Add rate limit info to request for headers
    request.rateLimit = {
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    };

    return true;
  }

  private async checkRateLimit(
    context: ExecutionContext,
    options: RateLimitOptions
  ): Promise<RateLimitResult> {
    const {
      windowMs = 15 * 60 * 1000, // 15 minutes default
      maxRequests = 100,
    } = options;

    const key = this.generateKey(context, options);
    const window = Math.floor(Date.now() / windowMs);
    const windowKey = `rate_limit:${key}:${window}`;

    try {
      const redis = this.redisService.getClient();
      const current = await redis.incr(windowKey);

      if (current === 1) {
        await redis.expire(windowKey, Math.ceil(windowMs / 1000));
      }

      const remaining = Math.max(0, maxRequests - current);
      const reset = (window + 1) * windowMs;

      return {
        success: current <= maxRequests,
        limit: maxRequests,
        remaining,
        reset,
        current,
      };
    } catch (error) {
      this.logger.error("Rate limit check failed:", error);
      // Fail open - allow request if Redis is down
      return {
        success: true,
        limit: maxRequests,
        remaining: maxRequests,
        reset: Date.now() + windowMs,
        current: 0,
      };
    }
  }

  private generateKey(
    context: ExecutionContext,
    options: RateLimitOptions
  ): string {
    const request = context.switchToHttp().getRequest<RequestWithRateLimit>();

    if (options.customKeyGenerator) {
      return options.customKeyGenerator(context);
    }

    const apiKeyHeader = request.headers["x-api-key"];
    const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
    const userId = request.user?.id || request.user?.sub;

    switch (options.keyGenerator) {
      case "ip":
        return this.getClientIp(request);

      case "apiKey":
        if (!apiKey) {
          throw new UnauthorizedException("API key required for this endpoint");
        }

        return `api:${apiKey}`;

      case "userId":
        if (!userId) {
          throw new UnauthorizedException(
            "User authentication required for this endpoint"
          );
        }

        return `user:${userId}`;

      default:
        return this.getClientIp(request);
    }
  }

  private getClientIp(request: RequestWithRateLimit): string {
    const ip =
      request.headers["x-forwarded-for"]?.toString().split(",")[0] ||
      request.headers["x-real-ip"]?.toString() ||
      request.socket?.remoteAddress ||
      "unknown";

    return `ip:${ip.trim()}`;
  }
}
