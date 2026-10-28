import { SecretsProvider } from '../secrets.interface';
import { CloudSecretsProvider } from './cloud-provider.interface';

/**
 * Adapter to make CloudSecretsProvider compatible with SecretsProvider interface
 *
 * CloudSecretsProvider is the interface of the cloud providers, while
 * SecretsProvider is the interface SecretsService uses for every provider,
 * local included.
 *
 * This adapter bridges the two interfaces, allowing cloud providers to work
 * with the existing SecretsService implementation.
 */
export class CloudProviderAdapter implements SecretsProvider {
  private cloudProvider: CloudSecretsProvider;

  constructor(cloudProvider: CloudSecretsProvider) {
    this.cloudProvider = cloudProvider;
  }

  /**
   * Read one secret from one scope
   */
  async read(key: string, scope: string): Promise<string | null> {
    return this.cloudProvider.read(key, scope);
  }

  /**
   * Get provider name
   */
  getName(): string {
    return this.cloudProvider.getProviderName();
  }
}
