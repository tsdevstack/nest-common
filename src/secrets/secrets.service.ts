import { Injectable } from '@nestjs/common';
import type { SecretsProvider } from './secrets.interface';
import type { SecretsConfig } from './secrets.interface';
import { LocalSecretsProvider } from './providers/local.provider';
import { SecretsProviderFactory } from './providers/provider-factory';
import { CloudProviderAdapter } from './providers/cloud-provider-adapter';
import { buildServiceApiKeyName } from './build-service-api-key-name';
import { readOwnThenShared } from './read-own-then-shared';
import {
  SECRETS_CACHE_TTL_MS,
  SERVICE_API_KEY_ALIAS,
} from './secrets.constants';

interface CachedSecret {
  value: string;
  expiresAt: number;
}

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
 * The lookup rules live here, the same for every provider: `API_KEY` is the
 * service's own key, the service's own scope wins over shared, and values
 * are cached. Providers only read one exact name.
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
  private readonly cache = new Map<string, CachedSecret>();
  // Lookups in flight, so concurrent reads of an expired key share one
  private readonly pending = new Map<string, Promise<string>>();
  private readonly cacheTtlMs: number;

  constructor(config: SecretsConfig) {
    this.config = config;

    // Use forced provider if specified, otherwise auto-detect
    this.provider = this.config.forceProvider || this.detectProvider();

    // Set service name on provider for scoped secret access
    if (
      'setServiceName' in this.provider &&
      typeof this.provider.setServiceName === 'function'
    ) {
      (this.provider as LocalSecretsProvider).setServiceName(
        this.config.serviceName,
      );
    }

    this.cacheTtlMs =
      this.provider.getName() === 'local'
        ? SECRETS_CACHE_TTL_MS.local
        : SECRETS_CACHE_TTL_MS.cloud;
  }

  /**
   * Get the current provider
   */
  getProvider(): SecretsProvider {
    return this.provider;
  }

  /**
   * Get a single secret by key with caching
   * Supports runtime secret refresh (cached for 1 minute locally, 5 minutes
   * in the cloud)
   *
   * The service's own value wins when a key exists in its scope and in the
   * shared scope. Both are read at once, so a cache miss waits for one
   * round-trip.
   *
   * `API_KEY` is this service's own API key, stored as `{SERVICE}_API_KEY`
   * (`auth-service` → `AUTH_SERVICE_API_KEY`). It is resolved here, above
   * every provider, so local development and all clouds read the same name.
   *
   * @param key - The secret key to retrieve
   * @returns The secret value
   * @throws Error if the secret is in neither scope, or the store cannot be read
   */
  async get(key: string): Promise<string> {
    const name =
      key === SERVICE_API_KEY_ALIAS
        ? buildServiceApiKeyName(this.config.serviceName)
        : key;

    const cached = this.cache.get(name);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    const inFlight = this.pending.get(name);
    if (inFlight) {
      return inFlight;
    }

    const lookup = this.lookup(name).finally(() => {
      this.pending.delete(name);
    });
    this.pending.set(name, lookup);
    return lookup;
  }

  /**
   * Clear any cached secrets
   * Forces next get() to reload from source
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Read a key from the service's scope and the shared scope, and cache it
   */
  private async lookup(name: string): Promise<string> {
    const value = await readOwnThenShared(
      (scope) => this.provider.read(name, scope),
      this.config.serviceName,
    );

    if (value === null) {
      throw new Error(
        `Secret "${name}" not found in ${this.provider.getName()} ` +
          `for service "${this.config.serviceName}" or the shared scope.`,
      );
    }

    // URLs change when services are deployed, and callers need the new one
    // at once, so they are not cached
    if (!this.isUrlValue(value)) {
      this.cache.set(name, {
        value,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
    }

    return value;
  }

  private isUrlValue(value: string): boolean {
    return value.startsWith('https://') || value.startsWith('http://');
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
    return new CloudProviderAdapter(cloudProvider);
  }
}
