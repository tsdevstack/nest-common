/**
 * Key a service reads its own API key by (`secrets.get('API_KEY')`, the
 * AuthGuard's service-key check). The key is stored once per service under
 * `{SERVICE}_API_KEY`, the name its callers read it by.
 */
export const SERVICE_API_KEY_ALIAS = 'API_KEY';

/** Suffix of the stored name: `AUTH_SERVICE_API_KEY` */
export const SERVICE_API_KEY_SUFFIX = '_API_KEY';

/**
 * Scope every service reads besides its own (`{project}-shared-{KEY}` in the
 * cloud, the top-level `secrets` block locally)
 */
export const SHARED_SECRETS_SCOPE = 'shared';

/** Block of `.secrets.local.json` that holds the shared scope */
export const LOCAL_SHARED_SECRETS_SECTION = 'secrets';

/**
 * How long a value read from the store is reused. Local development reads
 * the file again sooner so edits show up quickly.
 */
export const SECRETS_CACHE_TTL_MS = {
  local: 60 * 1000,
  cloud: 5 * 60 * 1000,
} as const;

/** gRPC status the GCP Secret Manager client reports for a missing secret */
export const GCP_SECRET_NOT_FOUND_CODE = 5;

/**
 * Errors that mean "no such secret" when reading from AWS Secrets Manager.
 * GetSecretValue answers a secret scheduled for deletion (removed, still in
 * its recovery window) with InvalidRequestException; its other documented
 * causes are about rotation and updates, not reads.
 */
export const AWS_SECRET_NOT_FOUND_ERRORS = [
  'ResourceNotFoundException',
  'InvalidRequestException',
];

/**
 * HTTP status Azure Key Vault answers a missing secret with, and a deleted
 * one still in its recovery period
 */
export const AZURE_SECRET_NOT_FOUND_STATUS = 404;
