import { HEALTH_PATH, METRICS_PATH } from '../auth/auth.constants';

/**
 * Whether request logging should be skipped for a path.
 *
 * Health probes and Prometheus scrapes hit every service every few seconds;
 * logging them buries real traffic. The query string is ignored.
 *
 * @param url - Request URL as Express reports it (path plus query string)
 * @returns true for `/metrics`, `/health` and `/health/...`
 */
export function isQuietRequestPath(url: string): boolean {
  const pathname = url.split('?')[0];
  return (
    pathname === METRICS_PATH ||
    pathname === HEALTH_PATH ||
    pathname.startsWith(`${HEALTH_PATH}/`)
  );
}
