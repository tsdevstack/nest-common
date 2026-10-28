/**
 * Cloud Secrets Provider Interface
 *
 * Common interface for all cloud secret providers (GCP, AWS, Azure).
 * Providers handle the cloud-specific API calls for one exact name; scope
 * order and caching live in SecretsService.
 */

export interface CloudSecretsProvider {
  /**
   * Read one secret: {project}-{scope}-{key}
   *
   * @param key Secret key (e.g., 'DATABASE_URL')
   * @param scope The service's own scope (its name) or `shared`
   * @returns Secret value, or null when no such secret exists
   * @throws Error when the store cannot answer (access denied, network)
   */
  read(key: string, scope: string): Promise<string | null>;

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
