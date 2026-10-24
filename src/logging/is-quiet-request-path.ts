import { HEALTH_PATH, METRICS_PATH } from '../auth/auth.constants';

/**
 * Whether a request is a health probe or a metrics scrape.
 *
 * They hit every service every few seconds; logged at info they would bury
 * real traffic, so the logging interceptor logs them at debug (failures at
 * warn). The query string is ignored.
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
