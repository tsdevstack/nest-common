/**
 * Secrets Provider Interface
 *
 * All secret providers (local, AWS, GCP, Azure) must implement this interface.
 * A provider reads one exact name; which scopes a lookup reads, in which
 * order, and caching are decided once, in SecretsService. Services only read
 * secrets: the CLI writes them (generate-secrets, cloud-secrets:*), and the
 * cloud identities services run with are read-only.
 */
export interface SecretsProvider {
  /**
   * Read one secret from one scope
   * @param key - The secret key
   * @param scope - The service's own scope (its name) or `shared`
   * @returns The value, or null when the scope has no such key
   * @throws Error when the store cannot answer (access denied, network);
   *   that is never reported as a missing key
   */
  read(key: string, scope: string): Promise<string | null>;

  /**
   * Get the provider name (for logging/debugging)
   */
  getName(): string;
}

/**
 * Cloud provider types supported by the framework
 */
export type CloudProvider = 'local' | 'aws' | 'gcp' | 'azure';

/**
 * Secrets strategy types
 */
export type SecretsStrategy =
  'local' | 'aws-secrets-manager' | 'gcp-secret-manager' | 'azure-key-vault';

/**
 * Configuration for secrets service
 */
export interface SecretsConfig {
  /**
   * The service name (e.g., 'auth-service')
   */
  serviceName: string;

  /**
   * Path to framework config file (for detecting cloud provider)
   * @default '.tsdevstack/config.json'
   */
  configPath?: string;

  /**
   * Force a specific provider (useful for testing)
   * If not specified, provider is auto-detected
   */
  forceProvider?: SecretsProvider;
}

/**
 * Result of loading secrets
 */
export interface SecretsLoadResult {
  /**
   * Whether secrets were loaded successfully
   */
  success: boolean;

  /**
   * The provider that was used
   */
  provider: string;

  /**
   * Number of secrets loaded
   */
  count: number;

  /**
   * Error message if loading failed
   */
  error?: string;
}
