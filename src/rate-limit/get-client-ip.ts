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
 *   `X-Tsdevstack-Real-IP`, else `X-Real-IP`. Kong's tsdevstack-client-ip
 *   plugin sets `X-Tsdevstack-Real-IP` on every request: the visitor a
 *   trusted frontend server named (the frontend calls Kong for its visitors,
 *   so `X-Real-IP` would be the frontend server for all of them), otherwise
 *   the address Kong resolved. Kong removes a client-sent value of it, and
 *   always overwrites `X-Real-IP` with the client address it resolved from
 *   its trusted proxies (nginx `$remote_addr`), so a client chooses neither.
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
    for (const name of ['x-tsdevstack-real-ip', 'x-real-ip']) {
      const header = request.headers[name];
      const address = (Array.isArray(header) ? header[0] : header)?.trim();
      if (address) {
        return address;
      }
    }
  }

  return request.socket?.remoteAddress?.trim() || 'unknown';
}
