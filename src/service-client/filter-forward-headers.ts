import type { IncomingHttpHeaders } from 'node:http';

/**
 * Headers that should NOT be forwarded in service-to-service calls.
 *
 * These headers are either:
 * - Connection-specific (must not be forwarded per HTTP spec)
 * - Set automatically by axios based on the target URL
 * - May cause routing issues in Cloud Run (host header)
 */
const SKIP_HEADERS = new Set([
  // Connection headers - must not be forwarded (RFC 7230)
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',

  // Host header - Cloud Run uses this for routing
  // Must be set by axios based on target URL, not forwarded from original request
  'host',

  // Content headers - axios handles these based on the actual body
  'content-length',
  'content-encoding',

  // Hop-by-hop headers
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
]);

/**
 * Filters request headers for forwarding in service-to-service calls.
 *
 * Use this when making internal service calls to forward authentication
 * and context headers while excluding headers that would break routing.
 *
 * @param headers - The incoming request headers (from Express/NestJS request object)
 * @returns Filtered headers safe to forward to internal services
 */
export function filterForwardHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    // Skip headers that shouldn't be forwarded
    if (SKIP_HEADERS.has(lowerKey)) {
      continue;
    }

    // Only include string values (skip arrays like set-cookie)
    if (typeof value === 'string') {
      result[key] = value;
    }
  }

  return result;
}