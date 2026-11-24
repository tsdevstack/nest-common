import { SERVICE_API_KEY_SUFFIX } from './secrets.constants';
import { toScreamingSnakeCase } from '../utils/to-screaming-snake-case';

/**
 * Returns the name a service's API key is stored under, as the CLI generates
 * it: `auth-service` → `AUTH_SERVICE_API_KEY`.
 *
 * @param serviceName - Service name (lowercase, hyphens)
 * @returns The secret key name
 */
export function buildServiceApiKeyName(serviceName: string): string {
  return `${toScreamingSnakeCase(serviceName)}${SERVICE_API_KEY_SUFFIX}`;
}
