import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  AuthenticatedApiKey,
  AuthenticatedRequest,
} from './auth-user.interface';

/**
 * Injects the partner API key that authenticated the request (`req.apiKey`):
 * its id and consumer, never the raw key.
 *
 * @returns `{ id, consumer }`, or undefined when the request was not made
 *   with a partner API key
 *
 * @example
 * ```typescript
 * @PartnerApi()
 * @Get('usage')
 * usage(@ApiKey() key: AuthenticatedApiKey) {
 *   return this.usageService.forKey(key.id);
 * }
 * ```
 */
export const ApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedApiKey | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().apiKey,
);
