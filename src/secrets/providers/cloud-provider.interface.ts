/**
 * Cloud Secrets Provider Interface
 *
 * Common interface for all cloud secret providers (GCP, AWS, Azure).
 * Providers handle cloud-specific API calls and caching.
 */

export interface CloudSecretsProvider {
  /**
   * Get secret value by key
   *
   * Provider handles:
   * - Service-scoped lookup: {project}-{service}-{key}
   * - Shared fallback: {project}-shared-{key}
   * - Caching (5-minute TTL)
   *
   * @param key Secret key (e.g., 'DATABASE_URL')
   * @returns Secret value or null if not found
   */
  get(key: string): Promise<string | null>;

  /**
   * Set secret value
   *
   * Provider determines scope (service vs shared) and creates/updates secret.
   *
   * @param key Secret key
   * @param value Secret value
   * @param metadata Optional metadata tags/labels
   */
  set(
    key: string,
    value: string,
    metadata?: Record<string, string>
  ): Promise<void>;

  /**
   * Remove secret from cloud
   *
   * @param key Secret key
   */
  remove(key: string): Promise<void>;

  /**
   * List all secret keys managed by tsdevstack
   *
   * Filters by: managed-by=tsdevstack
   *
   * @returns Array of secret keys (without project/scope prefix)
   */
  list(): Promise<string[]>;

  /**
   * Check if secret exists in cloud
   *
   * @param key Secret key
   * @returns True if exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get provider name
   *
   * @returns 'gcp' | 'aws' | 'azure' | 'local'
   */
  getProviderName(): string;
}

/**
 * Configuration for cloud providers
 */
export interface CloudProviderConfig {
  /**
   * Project name from .tsdevstack/config.json
   * Used as prefix for all secrets
   */
  projectName: string;

  /**
   * Service name (e.g., 'auth-service', 'bff-service')
   * Used for service-scoped secrets
   */
  serviceName: string;

  /**
   * Provider-specific configuration
   * - GCP: { projectId, credentialsPath }
   * - AWS: { region, credentialsPath }
   * - Azure: { vaultUrl, credentialsPath }
   */
  providerConfig?: Record<string, unknown>;
}

/**
 * Cache entry for secret values
 */
export interface CacheEntry {
  value: string;
  expiresAt: number;
}