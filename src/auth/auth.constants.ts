/**
 * OIDC discovery and JWKS endpoints: `/.well-known/` at the path start or
 * directly after the first segment (the service's global prefix, for example
 * `/auth/.well-known/jwks.json`). Kong's OIDC plugin fetches them directly,
 * without the trust token.
 */
export const WELL_KNOWN_PATH_PATTERN = /^(\/[^/]+)?\/\.well-known\//;

/** Health endpoint (and `/health/*`), called by probes without the trust token */
export const HEALTH_PATH = '/health';

/** Metrics endpoint, scraped by Prometheus without the trust token */
export const METRICS_PATH = '/metrics';

/** `req.service` value for requests authenticated with a partner API key */
export const PARTNER_SERVICE_NAME = 'partner';

/** `req.service` value for internal calls that do not send `X-Service-Name` */
export const INTERNAL_SERVICE_NAME = 'internal';

/** Claim names never copied into `req.user` (prototype pollution) */
export const UNSAFE_CLAIM_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
