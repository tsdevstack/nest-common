import { SecretClient } from '@azure/keyvault-secrets';
import { ClientSecretCredential } from '@azure/identity';
import {
  CloudSecretsProvider,
  CloudProviderConfig,
  CacheEntry,
} from './cloud-provider.interface';

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

    // Initialize Azure Key Vault client
    // Credentials are automatically loaded from:
    // 1. Environment variables (AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID)
    // 2. Managed identity (in Azure environments)
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error(
        'Azure credentials are required. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET environment variables.',
      );
    }

    const credential = new ClientSecretCredential(
      tenantId,
      clientId,
      clientSecret,
    );

    const vaultUrl = `https://${this.keyVaultName}.vault.azure.net`;
    this.client = new SecretClient(vaultUrl, credential);
  }

  /**
   * Get secret with service-scoped → shared fallback and caching
   */
  async get(key: string): Promise<string | null> {
    // Check cache first
    const cached = this.getFromCache(key);
    if (cached !== null) {
      return cached;
    }

    // Try service-scoped secret first
    const serviceScopedName = this.buildSecretName(key, this.serviceName);
    let value = await this.fetchSecretFromAzure(serviceScopedName);

    // Fall back to shared scope if service-scoped doesn't exist
    if (value === null) {
      const sharedScopedName = this.buildSecretName(key, 'shared');
      value = await this.fetchSecretFromAzure(sharedScopedName);
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
      );
    }
  }

  /**
   * List all secrets for this service (both service-scoped and shared)
   */
  async list(): Promise<string[]> {
    const secrets: string[] = [];

    try {
      // List all secret properties
      for await (const properties of this.client.listPropertiesOfSecrets()) {
        // Filter by project-name tag
        if (properties.tags?.['project-name'] === this.projectName) {
          const key = this.extractKeyFromSecretName(properties.name);
          secrets.push(key);
        }
      }

      return secrets;
    } catch (error) {
      throw new Error(
        `Failed to list secrets from Azure: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Check if a secret exists (checks both service-scoped and shared)
   */
  async exists(key: string): Promise<boolean> {
    // Check service-scoped first
    const serviceScopedName = this.buildSecretName(key, this.serviceName);

    try {
      await this.client.getSecret(serviceScopedName);
      return true;
    } catch {
      // Secret doesn't exist, check shared scope
    }

    // Check shared scope
    const sharedScopedName = this.buildSecretName(key, 'shared');

    try {
      await this.client.getSecret(sharedScopedName);
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
   * Extract key from secret name and reverse transform
   * Input: "tsdevstack-auth-service-DATABASE-URL" or "tsdevstack-shared-DATABASE-URL"
   * Output: "DATABASE_URL"
   */
  private extractKeyFromSecretName(secretName: string): string {
    // Remove the project name prefix first
    const withoutProject = secretName.substring(this.projectName.length + 1);

    let key: string;

    // Check if it starts with the service name
    if (withoutProject.startsWith(`${this.serviceName}-`)) {
      key = withoutProject.substring(this.serviceName.length + 1);
    } else if (withoutProject.startsWith('shared-')) {
      // Otherwise assume it's shared scope
      key = withoutProject.substring('shared-'.length);
    } else {
      // Fallback: just return the remaining part after first dash
      const firstDashIndex = withoutProject.indexOf('-');
      key =
        firstDashIndex >= 0
          ? withoutProject.substring(firstDashIndex + 1)
          : withoutProject;
    }

    // Reverse transform hyphens back to underscores
    return this.reverseTransformKey(key);
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
