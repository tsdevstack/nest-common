import { SERVICE_API_KEY_SUFFIX } from './secrets.constants';

/**
 * Returns the name a service's API key is stored under, as the CLI generates
 * it: `auth-service` → `AUTH_SERVICE_API_KEY`.
 *
 * @param serviceName - Service name (lowercase, hyphens)
 * @returns The secret key name
 */
export function buildServiceApiKeyName(serviceName: string): string {
  return `${serviceName.toUpperCase().replace(/-/g, '_')}${SERVICE_API_KEY_SUFFIX}`;
}
