import type { AuthenticatedApiKey } from '../auth-user.interface';

/**
 * Returns the consumer of the partner API key that authenticated the request.
 *
 * @param request - Request populated by `AuthGuard`
 * @returns The consumer name, or undefined for non-partner requests
 */
export function getRequestPartner(request: {
  apiKey?: AuthenticatedApiKey;
}): string | undefined {
  return request.apiKey?.consumer;
}
