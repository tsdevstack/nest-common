/**
 * Key part of a cloud secret name `${projectName}-${scope}-${KEY}` on GCP and
 * AWS: UPPERCASE_WITH_UNDERSCORES. Scopes (`shared`, service names) are
 * lowercase, so a key always starts with an uppercase letter.
 */
export const CLOUD_SECRET_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Key part of an Azure Key Vault secret name. Key Vault allows only
 * alphanumerics and hyphens, so the key's underscores are written as hyphens
 * (DATABASE_URL → DATABASE-URL).
 */
export const AZURE_SECRET_KEY_PATTERN = /^[A-Z][A-Z0-9-]*$/;
