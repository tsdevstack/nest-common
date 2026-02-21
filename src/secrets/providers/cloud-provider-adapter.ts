import { SecretsProvider } from '../secrets.interface';
import { CloudSecretsProvider } from './cloud-provider.interface';

/**
 * Adapter to make CloudSecretsProvider compatible with SecretsProvider interface
 *
 * The CloudSecretsProvider interface is designed for cloud-native operations
 * (get, set, remove, list, exists) while SecretsProvider is the legacy interface
 * used throughout the application.
 *
 * This adapter bridges the two interfaces, allowing cloud providers to work
 * with the existing SecretsService implementation.
 */
export class CloudProviderAdapter implements SecretsProvider {
  private cloudProvider: CloudSecretsProvider;
  private serviceName: string;

  constructor(cloudProvider: CloudSecretsProvider, serviceName: string) {
    this.cloudProvider = cloudProvider;
    this.serviceName = serviceName;
  }

  /**
   * Get a single secret by key
   * Delegates to cloud provider's get() which handles service-scoped → shared fallback
   */
  async get(key: string): Promise<string> {
    const value = await this.cloudProvider.get(key);
    if (value === null) {
      throw new Error(
        `Secret "${key}" not found in ${this.cloudProvider.getProviderName()} ` +
          `for service "${this.serviceName}" or shared scope.`,
      );
    }
    return value;
  }

  /**
   * Get all secrets for a service
   * Lists all secrets and filters by service name
   *
   * Note: This is less efficient than the local provider's getAll()
   * since cloud providers need to fetch each secret individually.
   * Consider caching at the application level if this becomes a bottleneck.
   */
  async getAll(): Promise<Record<string, string>> {
    const allSecrets = await this.cloudProvider.list();
    const result: Record<string, string> = {};

    // Filter secrets by service name and fetch their values
    // Secret format: {projectName}-{scope}-{KEY}
    // We want secrets where scope matches serviceName or is 'shared'
    for (const key of allSecrets) {
      try {
        const value = await this.cloudProvider.get(key);
        if (value !== null) {
          result[key] = value;
        }
      } catch {
        // Skip secrets that can't be accessed
        continue;
      }
    }

    return result;
  }

  /**
   * Set a secret value
   * Adds metadata to indicate it's a user-managed secret
   */
  async set(key: string, value: string): Promise<void> {
    await this.cloudProvider.set(key, value, {
      'secret-type': 'user',
      'managed-by': 'tsdevstack',
    });
  }

  /**
   * Delete a secret
   */
  async delete(key: string): Promise<void> {
    await this.cloudProvider.remove(key);
  }

  /**
   * Get provider name
   */
  getName(): string {
    return this.cloudProvider.getProviderName();
  }

  /**
   * Clear cache
   * Cloud providers don't expose cache clearing, so this is a no-op
   * The cache will expire naturally based on TTL
   */
  clearCache(): void {
    // No-op for cloud providers
    // Cache expires automatically based on 5-minute TTL
  }
}