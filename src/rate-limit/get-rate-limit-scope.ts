import type { ExecutionContext } from '@nestjs/common';

/**
 * Returns the route a rate limit counter belongs to:
 * `<service>:<Controller>.<handler>`.
 *
 * Each route counts separately, as in @nestjs/throttler (controller and
 * handler name). Without it, every route with the same limit type and window
 * shared one counter per client: a few failed logins used up the refresh,
 * logout and password reset limits of that address. The service name is
 * part of it because every service uses the same Redis and controller names
 * repeat across services (UserController). SERVICE_NAME is set at startup
 * by startApp and startWorker from package.json.
 *
 * @param context - The request's execution context
 * @returns The scope to put in the Redis key
 */
export function getRateLimitScope(context: ExecutionContext): string {
  const service = process.env.SERVICE_NAME || 'service';
  const controller = context.getClass().name || 'controller';
  const handler = context.getHandler().name || 'handler';
  return `${service}:${controller}.${handler}`;
}
