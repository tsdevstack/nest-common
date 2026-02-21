/**
 * Secrets Provider Interface
 *
 * All secret providers (local, AWS, GCP, Azure) must implement this interface.
 */
export interface SecretsProvider {
  /**
   * Get all secrets for a specific service
   * @param serviceName - The name of the service (e.g., 'auth-service', 'shared')
   * @returns Object containing all secrets for the service
   */
  getAll(serviceName: string): Promise<Record<string, string>>;

  /**
   * Get a single secret by key
   * Supports caching with TTL for performance
   * @param key - The secret key to retrieve
   * @returns The secret value
   * @throws Error if secret not found
   */
  get(key: string): Promise<string>;

  /**
   * Set a secret value
   * For local provider: Updates .secrets.user.json and triggers regeneration
   * For cloud providers: Updates the secret in the cloud provider
   * @param key - The secret key
   * @param value - The secret value
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Delete a secret
   * For local provider: Removes from .secrets.user.json and triggers regeneration
   * For cloud providers: Deletes from the cloud provider
   * @param key - The secret key to delete
   */
  delete(key: string): Promise<void>;

  /**
   * Get the provider name (for logging/debugging)
   */
  getName(): string;

  /**
   * Clear any cached secrets
   * Forces next get() to reload from source
   */
  clearCache(): void;
}

/**
 * Cloud provider types supported by the framework
 */
export type CloudProvider = 'local' | 'aws' | 'gcp' | 'azure';

/**
 * Secrets strategy types
 */
export type SecretsStrategy =
  | 'local'
  | 'aws-secrets-manager'
  | 'gcp-secret-manager'
  | 'azure-key-vault';

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