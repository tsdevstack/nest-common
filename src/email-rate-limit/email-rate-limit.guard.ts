import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import {
  EMAIL_RATE_LIMIT_KEY,
  EmailRateLimitOptions,
} from "./email-rate-limit.decorator";
import { RedisService } from "../redis/redis.service";

interface EmailRateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  current: number;
}

@Injectable()
export class EmailRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(EmailRateLimitGuard.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<EmailRateLimitOptions>(
      EMAIL_RATE_LIMIT_KEY,
      context.getHandler()
    );

    if (!options) {
      return true; // No email rate limiting applied
    }

    const request = context.switchToHttp().getRequest<Request>();
    const result = await this.checkEmailRateLimit(request, options);

    if (!result.success) {
      const message =
        options.message || "Too many requests for this email address";

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message,
          error: "Email Rate Limit Exceeded",
          limit: result.limit,
          remaining: result.remaining,
          reset: result.reset,
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    return true;
  }

  private async checkEmailRateLimit(
    request: Request,
    options: EmailRateLimitOptions
  ): Promise<EmailRateLimitResult> {
    const {
      windowMs = 15 * 60 * 1000, // 15 minutes default
      maxRequests = 5,
      emailField = "email",
    } = options;

    // Extract email from request body with proper typing
    const requestBody = request.body as Record<string, unknown>;
    const emailValue = requestBody?.[emailField];

    if (!emailValue || typeof emailValue !== "string") {
      // If no email in request, skip email-based rate limiting
      return {
        success: true,
        limit: maxRequests,
        remaining: maxRequests,
        reset: Date.now() + windowMs,
        current: 0,
      };
    }

    const normalizedEmail = emailValue.toLowerCase().trim();
    const window = Math.floor(Date.now() / windowMs);
    const windowKey = `email_rate_limit:${normalizedEmail}:${window}`;

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
      this.logger.error("Email rate limit check failed:", error);
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
}
