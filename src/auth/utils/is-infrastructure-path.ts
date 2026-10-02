import {
  HEALTH_PATH,
  METRICS_PATH,
  WELL_KNOWN_PATH_PATTERN,
} from '../auth.constants';

/**
 * Whether a pathname is an infrastructure endpoint that is called without
 * the Kong trust token (OIDC discovery and JWKS, health probes, metrics).
 *
 * Only the pathname counts: pass it without the query string (see
 * `getRequestPathname`), so `?next=/health` cannot trigger the exemption.
 *
 * @param pathname - Request path without query string
 * @returns true for `/.well-known/*` and `/{prefix}/.well-known/*`,
 *   `/health`, `/health/*` and `/metrics`
 */
export function isInfrastructurePath(pathname: string): boolean {
  return (
    WELL_KNOWN_PATH_PATTERN.test(pathname) ||
    pathname === HEALTH_PATH ||
    pathname.startsWith(`${HEALTH_PATH}/`) ||
    pathname === METRICS_PATH
  );
}
