import { SecretClient } from '@azure/keyvault-secrets';
import {
  DefaultAzureCredential,
  ClientSecretCredential,
} from '@azure/identity';
import type { TokenCredential } from '@azure/identity';
import {
  CloudSecretsProvider,
  CloudProviderConfig,
  CacheEntry,
} from './cloud-provider.interface';
import { extractScopedSecretKey } from './extract-scoped-secret-key';
import { AZURE_SECRET_KEY_PATTERN } from '../secrets.constants';

export class AzureSecretsProvider implements CloudSecretsProvider {
  private client: SecretClient;
  private projectName: string;
  private serviceName: string;
  private keyVaultName: string;
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: CloudProviderConfig) {
    this.projectName = config.projectName;
    this.serviceName = config.serviceName;
    this.keyVaultName =
      process.env.AZURE_KEYVAULT_NAME ||
      (config.providerConfig?.keyVaultName as string) ||
      '';

    // Validate required config
    if (!this.keyVaultName) {
      throw new Error(
        'Azure Key Vault name is required. Set AZURE_KEYVAULT_NAME environment variable.',
      );
    }

    // Credential strategy:
    // 1. If AZURE_CLIENT_SECRET is set → use ClientSecretCredential (backward compat / local dev)
    // 2. Otherwise → use DefaultAzureCredential (managed identity in Container Apps)
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    let credential: TokenCredential;

    if (tenantId && clientId && clientSecret) {
      credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    } else {
      // DefaultAzureCredential picks up managed identity in Azure.
      // AZURE_CLIENT_ID selects the user-assigned identity.
      credential = new DefaultAzureCredential();
    }

    const vaultUrl = `https://${this.keyVaultName}.vault.azure.net`;
    this.client = new SecretClient(vaultUrl, credential);
  }

  /**
   * Get secret with shared → service-scoped fallback and caching
   */
  async get(key: string): Promise<string | null> {
    // Check cache first
    const cached = this.getFromCache(key);
    if (cached !== null) {
      return cached;
    }

    // Shared scope first: every runtime-read secret lives in shared (the
    // only service-scoped secret, DATABASE_URL, is injected as an env var
    // at deploy time and never read here). Scoped-first meant a
    // guaranteed-404 round-trip on every cache-miss lookup.
    const sharedScopedName = this.buildSecretName(key, 'shared');
    let value = await this.fetchSecretFromAzure(sharedScopedName);

    // Fall back to service scope for explicitly scoped secrets
    if (value === null) {
      const serviceScopedName = this.buildSecretName(key, this.serviceName);
      value = await this.fetchSecretFromAzure(serviceScopedName);
    }

    // Cache the result (including null to avoid repeated lookups)
    if (value !== null) {
      this.setCache(key, value);
    }

    return value;
  }

  /**
   * Set a secret with optional metadata tags
   */
  async set(
    key: string,
    value: string,
    metadata?: Record<string, string>,
  ): Promise<void> {
    const secretName = this.buildSecretName(key, this.serviceName);

    try {
      // Build tags (Azure limit: 15 tags)
      const tags = this.buildTags(metadata);

      // Set the secret with tags
      await this.client.setSecret(secretName, value, { tags });

      // Invalidate cache
      this.invalidateCache(key);
    } catch (error) {
      throw new Error(
        `Failed to set secret ${secretName} in Azure: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Remove a secret
   * Note: Azure soft-deletes secrets by default (recoverable for 90 days)
   */
  async remove(key: string): Promise<void> {
    const secretName = this.buildSecretName(key, this.serviceName);

    try {
      const poller = await this.client.beginDeleteSecret(secretName);
      await poller.pollUntilDone();

      // Invalidate cache
      this.invalidateCache(key);
    } catch (error) {
      throw new Error(
        `Failed to remove secret ${secretName} from Azure: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * List all secrets for this service (both service-scoped and shared)
   *
   * Secrets of other services in the project are skipped. A key that exists
   * in both scopes is listed once (get() returns the shared value).
   */
  async list(): Promise<string[]> {
    const scopePrefixes = this.buildScopePrefixes();
    const keys = new Set<string>();

    try {
      // List all secret properties
      for await (const properties of this.client.listPropertiesOfSecrets()) {
        // Filter by project-name tag
        if (properties.tags?.['project-name'] === this.projectName) {
          const azureKey = extractScopedSecretKey(
            properties.name,
            scopePrefixes,
            AZURE_SECRET_KEY_PATTERN,
          );
          if (azureKey !== null) {
            keys.add(this.reverseTransformKey(azureKey));
          }
        }
      }

      return [...keys];
    } catch (error) {
      throw new Error(
        `Failed to list secrets from Azure: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Check if a secret exists (checks both shared and service-scoped)
   */
  async exists(key: string): Promise<boolean> {
    // Check shared scope first (same ordering rationale as get())
    const sharedScopedName = this.buildSecretName(key, 'shared');

    try {
      await this.client.getSecret(sharedScopedName);
      return true;
    } catch {
      // Secret doesn't exist, check service scope
    }

    // Check service scope
    const serviceScopedName = this.buildSecretName(key, this.serviceName);

    try {
      await this.client.getSecret(serviceScopedName);
      return true;
    } catch {
      return false;
    }
  }

  getProviderName(): string {
    return 'azure';
  }

  /**
   * Build secret name following convention: {projectName}-{scope}-{KEY}
   * Azure Key Vault only allows alphanumeric and hyphens
   * Transform underscores to hyphens: DATABASE_URL → DATABASE-URL
   */
  private buildSecretName(key: string, scope: string): string {
    const transformedKey = this.transformKey(key);
    return `${this.projectName}-${scope}-${transformedKey}`;
  }

  /**
   * Name prefixes of the scopes list() returns: shared, and this service when
   * a service name is set. Built like the names get() reads (only the key is
   * transformed, so the prefix is `${projectName}-${scope}-`).
   */
  private buildScopePrefixes(): string[] {
    const scopes = this.serviceName ? ['shared', this.serviceName] : ['shared'];
    return scopes.map((scope) => this.buildSecretName('', scope));
  }

  /**
   * Fetch secret value from Azure
   */
  private async fetchSecretFromAzure(
    secretName: string,
  ): Promise<string | null> {
    try {
      const secret = await this.client.getSecret(secretName);
      return secret.value || null;
    } catch {
      // Secret doesn't exist or access denied
      return null;
    }
  }

  /**
   * Build Azure tags from metadata
   * Azure supports up to 15 tags per secret
   */
  private buildTags(metadata?: Record<string, string>): Record<string, string> {
    const tags: Record<string, string> = {
      'project-name': this.projectName,
      'service-name': this.serviceName,
      'managed-by': 'tsdevstack',
    };

    if (metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        tags[key] = value;
      }
    }

    return tags;
  }

  /**
   * Transform key to Azure-compatible format
   * Azure Key Vault only allows alphanumeric and hyphens
   * DATABASE_URL → DATABASE-URL
   */
  private transformKey(key: string): string {
    return key.replace(/_/g, '-');
  }

  /**
   * Reverse transform Azure key back to standard format
   * DATABASE-URL → DATABASE_URL
   */
  private reverseTransformKey(key: string): string {
    return key.replace(/-/g, '_');
  }

  /**
   * Cache management methods
   */
  private getFromCache(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  private setCache(key: string, value: string): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });
  }

  private invalidateCache(key: string): void {
    this.cache.delete(key);
  }
}
