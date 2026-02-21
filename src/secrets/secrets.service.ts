import { Injectable } from '@nestjs/common';
import type { SecretsProvider } from './secrets.interface';
import type { SecretsConfig } from './secrets.interface';
import { LocalSecretsProvider } from './providers/local.provider';
import { SecretsProviderFactory } from './providers/provider-factory';
import { CloudProviderAdapter } from './providers/cloud-provider-adapter';

/**
 * Secrets Service
 *
 * Service for runtime secret access through provider abstraction.
 * Detects provider based on SECRETS_PROVIDER environment variable.
 *
 * Usage pattern:
 * ```typescript
 * @Injectable()
 * class MyService {
 *   constructor(private secrets: SecretsService) {}
 *
 *   async doSomething() {
 *     const apiKey = await this.secrets.get('API_KEY');
 *     // Cached for 1 minute (local), 5 minutes (cloud)
 *   }
 * }
 * ```
 *
 * IMPORTANT: Apps should NEVER use process.env to access secrets.
 * Always inject SecretsService and use await this.secrets.get('KEY').
 *
 * Requires SECRETS_PROVIDER env var to be set to: local, aws, gcp, or azure
 */
@Injectable()
export class SecretsService {
  private provider: SecretsProvider;
  private config: SecretsConfig;

  constructor(config: SecretsConfig) {
    this.config = config;

    // Use forced provider if specified, otherwise auto-detect
    this.provider = this.config.forceProvider || this.detectProvider();

    // Set service name on provider for scoped secret access
    if ('setServiceName' in this.provider && typeof this.provider.setServiceName === 'function') {
      (this.provider as LocalSecretsProvider).setServiceName(this.config.serviceName);
    }
  }


  /**
   * Get the current provider
   */
  getProvider(): SecretsProvider {
    return this.provider;
  }

  /**
   * Get a single secret by key with caching
   * Supports runtime secret refresh (cached for 1 minute in local provider)
   *
   * @param key - The secret key to retrieve
   * @returns The secret value
   * @throws Error if secret not found
   */
  async get(key: string): Promise<string> {
    return this.provider.get(key);
  }

  /**
   * Set a secret value
   * For local provider: Updates .secrets.user.json and triggers regeneration
   * For cloud providers: Updates the secret in the cloud provider
   *
   * @param key - The secret key
   * @param value - The secret value
   */
  async set(key: string, value: string): Promise<void> {
    await this.provider.set(key, value);
  }

  /**
   * Delete a secret
   * For local provider: Removes from .secrets.user.json and triggers regeneration
   * For cloud providers: Deletes from the cloud provider
   *
   * @param key - The secret key to delete
   */
  async delete(key: string): Promise<void> {
    await this.provider.delete(key);
  }

  /**
   * Clear any cached secrets
   * Forces next get() to reload from source
   */
  clearCache(): void {
    this.provider.clearCache();
  }

  /**
   * Auto-detect which secrets provider to use based on SECRETS_PROVIDER env var
   */
  private detectProvider(): SecretsProvider {
    const provider = process.env.SECRETS_PROVIDER;

    if (!provider) {
      throw new Error(
        'SECRETS_PROVIDER environment variable is required.\n' +
          'Set it to: local, aws, gcp, or azure\n' +
          'For local development, tsdevstack automatically sets this in .env file.',
      );
    }

    if (provider === 'local') {
      // Use legacy local provider
      const localProvider = new LocalSecretsProvider('.secrets.local.json');
      localProvider.setServiceName(this.config.serviceName);
      return localProvider;
    }

    // Use cloud provider factory for gcp, aws, azure
    const cloudProvider = SecretsProviderFactory.createProvider(
      this.config.serviceName,
    );

    if (!cloudProvider) {
      // Factory returned null, meaning we should use local provider
      // This shouldn't happen since we already checked for 'local' above,
      // but handle it gracefully
      const localProvider = new LocalSecretsProvider('.secrets.local.json');
      localProvider.setServiceName(this.config.serviceName);
      return localProvider;
    }

    // Wrap cloud provider in adapter to match SecretsProvider interface
    return new CloudProviderAdapter(cloudProvider, this.config.serviceName);
  }
}