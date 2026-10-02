/**
 * Resolve the client address used by IP-based rate limits
 */

/** Request fields the client address is read from (Express compatible) */
export interface ClientIpRequest {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  /** Set by AuthGuard after the Kong trust token was verified */
  viaGateway?: boolean;
}

/**
 * Returns the client address:
 *
 * - Through Kong (`viaGateway`, set by AuthGuard after the trust check):
 *   `X-Real-IP`. Kong always overwrites it with the client address it
 *   resolved from its trusted proxies (nginx `$remote_addr`), so a client
 *   cannot choose it.
 * - Otherwise (direct and internal calls, or no AuthGuard ran): the socket
 *   address.
 *
 * `X-Forwarded-For` is never used: its first entry is whatever the client
 * sent (Kong appends to it).
 *
 * @returns The address, or `unknown`
 */
export function getClientIp(request: ClientIpRequest): string {
  if (request.viaGateway === true) {
    const header = request.headers['x-real-ip'];
    const realIp = (Array.isArray(header) ? header[0] : header)?.trim();
    if (realIp) {
      return realIp;
    }
  }

  return request.socket?.remoteAddress?.trim() || 'unknown';
}
