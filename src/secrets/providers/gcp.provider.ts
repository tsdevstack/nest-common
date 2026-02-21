import { Logger } from '@nestjs/common';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import {
  CloudSecretsProvider,
  CloudProviderConfig,
  CacheEntry,
} from './cloud-provider.interface';

export class GCPSecretsProvider implements CloudSecretsProvider {
  private readonly logger = new Logger('GCPSecretsProvider');
  private client: SecretManagerServiceClient;
  private projectName: string;
  private serviceName: string;
  private gcpProjectId: string;
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: CloudProviderConfig) {
    console.log('[GCP] Constructor start');
    this.projectName = config.projectName;
    this.serviceName = config.serviceName;

    // GCP project ID from env var (set by deployment) or config
    this.gcpProjectId =
      process.env.GCP_PROJECT_ID ||
      (config.providerConfig?.projectId as string);
    if (!this.gcpProjectId) {
      throw new Error(
        'GCP_PROJECT_ID environment variable is required for GCP secrets provider',
      );
    }

    console.log(
      `[GCP] Initializing for project: ${this.gcpProjectId}, service: ${this.serviceName}`,
    );

    // Initialize GCP Secret Manager client
    // Credentials are automatically loaded from:
    // 1. GOOGLE_APPLICATION_CREDENTIALS env var (pointing to credentials JSON)
    // 2. Application Default Credentials (ADC) in cloud environments
    console.log('[GCP] Creating SecretManagerServiceClient...');
    this.client = new SecretManagerServiceClient();
    console.log('[GCP] SecretManagerServiceClient created');
  }

  /**
   * Get secret with service-scoped → shared fallback and caching
   */
  async get(key: string): Promise<string | null> {
    console.log(`[GCP] get() called for: ${key}`);

    // Check cache first
    const cached = this.getFromCache(key);
    if (cached !== null) {
      this.logger.debug(`Cache hit for: ${key}`);
      return cached;
    }

    let value: string | null = null;

    // API_KEY is a special case: always resolve to {SERVICE_NAME}_API_KEY in shared scope
    // e.g., auth-service asking for API_KEY → AUTH_SERVICE_API_KEY in shared
    if (key === 'API_KEY') {
      const sharedKey = `${this.serviceName.toUpperCase().replace(/-/g, '_')}_API_KEY`;
      const sharedScopedName = this.buildSecretName(sharedKey, 'shared');
      value = await this.fetchSecretFromGCP(sharedScopedName);
    } else {
      // Try service-scoped secret first
      const serviceScopedName = this.buildSecretName(key, this.serviceName);
      value = await this.fetchSecretFromGCP(serviceScopedName);

      // Fall back to shared scope if service-scoped doesn't exist
      if (value === null) {
        const sharedScopedName = this.buildSecretName(key, 'shared');
        value = await this.fetchSecretFromGCP(sharedScopedName);
      }
    }

    // Cache the result (including null to avoid repeated lookups)
    if (value !== null) {
      this.logger.debug(`Secret found: ${key}`);
      this.setCache(key, value);
    } else {
      this.logger.warn(`Secret not found: ${key}`);
    }

    return value;
  }

  /**
   * Set a secret with optional metadata labels
   */
  async set(
    key: string,
    value: string,
    metadata?: Record<string, string>,
  ): Promise<void> {
    const secretName = this.buildSecretName(key, this.serviceName);
    const parent = `projects/${this.gcpProjectId}`;
    const secretId = this.extractSecretId(secretName);

    try {
      // Check if secret exists
      const exists = await this.exists(key);

      if (!exists) {
        // Create new secret with labels
        await this.client.createSecret({
          parent,
          secretId,
          secret: {
            replication: {
              automatic: {},
            },
            labels: this.buildLabels(metadata),
          },
        });
      }

      // Add new version with the value
      await this.client.addSecretVersion({
        parent: `${parent}/secrets/${secretId}`,
        payload: {
          data: Buffer.from(value, 'utf8'),
        },
      });

      // Invalidate cache
      this.invalidateCache(key);
    } catch (error) {
      throw new Error(
        `Failed to set secret ${secretName} in GCP: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Remove a secret
   */
  async remove(key: string): Promise<void> {
    const secretName = this.buildSecretName(key, this.serviceName);
    const parent = `projects/${this.gcpProjectId}`;
    const secretId = this.extractSecretId(secretName);

    try {
      await this.client.deleteSecret({
        name: `${parent}/secrets/${secretId}`,
      });

      // Invalidate cache
      this.invalidateCache(key);
    } catch (error) {
      throw new Error(
        `Failed to remove secret ${secretName} from GCP: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * List all secrets for this service (both service-scoped and shared)
   */
  async list(): Promise<string[]> {
    const parent = `projects/${this.gcpProjectId}`;
    const secrets: string[] = [];

    try {
      const [secretsResponse] = await this.client.listSecrets({
        parent,
        filter: `labels.project-name=${this.projectName}`,
      });

      for (const secret of secretsResponse) {
        if (secret.name) {
          // Extract the key from the secret name
          // Format: projects/{project}/secrets/{projectName}-{scope}-{KEY}
          const secretId = secret.name.split('/').pop();
          if (secretId) {
            const key = this.extractKeyFromSecretId(secretId);
            secrets.push(key);
          }
        }
      }

      return secrets;
    } catch (error) {
      throw new Error(
        `Failed to list secrets from GCP: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Check if a secret exists (checks both service-scoped and shared)
   */
  async exists(key: string): Promise<boolean> {
    const parent = `projects/${this.gcpProjectId}`;

    // Check service-scoped first
    const serviceScopedName = this.buildSecretName(key, this.serviceName);
    const serviceScopedId = this.extractSecretId(serviceScopedName);

    try {
      await this.client.getSecret({
        name: `${parent}/secrets/${serviceScopedId}`,
      });
      return true;
    } catch {
      // Secret doesn't exist, check shared scope
    }

    // Check shared scope
    const sharedScopedName = this.buildSecretName(key, 'shared');
    const sharedScopedId = this.extractSecretId(sharedScopedName);

    try {
      await this.client.getSecret({
        name: `${parent}/secrets/${sharedScopedId}`,
      });
      return true;
    } catch {
      return false;
    }
  }

  getProviderName(): string {
    return 'gcp';
  }

  /**
   * Build secret name following convention: {projectName}-{scope}-{KEY}
   */
  private buildSecretName(key: string, scope: string): string {
    return `${this.projectName}-${scope}-${key}`;
  }

  /**
   * Extract secret ID from full secret name
   * Input: "tsdevstack-auth-service-DATABASE_URL"
   * Output: "tsdevstack-auth-service-DATABASE_URL"
   */
  private extractSecretId(secretName: string): string {
    return secretName;
  }

  /**
   * Extract key from secret ID
   * Input: "tsdevstack-auth-service-DATABASE_URL"
   * Output: "DATABASE_URL"
   */
  private extractKeyFromSecretId(secretId: string): string {
    const parts = secretId.split('-');
    // Skip projectName and scope, take the rest
    // Format: {projectName}-{scope}-{KEY}
    return parts.slice(2).join('-');
  }

  /**
   * Fetch secret value from GCP
   */
  private async fetchSecretFromGCP(secretName: string): Promise<string | null> {
    const parent = `projects/${this.gcpProjectId}`;
    const secretId = this.extractSecretId(secretName);
    const versionName = `${parent}/secrets/${secretId}/versions/latest`;

    console.log(`[GCP] Fetching: ${secretId}`);

    try {
      const [version] = await this.client.accessSecretVersion({
        name: versionName,
      });
      console.log(`[GCP] Fetched: ${secretId}`);

      if (!version.payload?.data) {
        return null;
      }

      return version.payload.data.toString();
    } catch (error) {
      const errorCode = (error as { code?: number })?.code;
      console.log(`[GCP] Error for ${secretId}: code=${errorCode}`);

      // NOT_FOUND (5) is expected when secret doesn't exist - don't log
      if (errorCode === 5) {
        return null;
      }

      // Log all other errors (permission denied, network, timeout, etc.)
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[GCP] Failed: ${secretId}: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Build GCP labels from metadata
   * GCP supports up to 64 labels per secret
   */
  private buildLabels(
    metadata?: Record<string, string>,
  ): Record<string, string> {
    const labels: Record<string, string> = {
      'project-name': this.projectName,
      'service-name': this.serviceName,
      'managed-by': 'tsdevstack',
    };

    if (metadata) {
      // GCP label keys must be lowercase, start with letter, and contain only lowercase letters, numbers, hyphens, underscores
      // Convert keys to lowercase and replace invalid characters
      for (const [key, value] of Object.entries(metadata)) {
        const sanitizedKey = key
          .toLowerCase()
          .replace(/[^a-z0-9-_]/g, '-')
          .replace(/^[^a-z]/, 'x');
        labels[sanitizedKey] = value;
      }
    }

    return labels;
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
    // Skip caching for URL values - they change during deployments
    // and dependent services need fresh URLs immediately
    if (this.isUrlValue(value)) {
      return;
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });
  }

  private isUrlValue(value: string): boolean {
    return value.startsWith('https://') || value.startsWith('http://');
  }

  private invalidateCache(key: string): void {
    this.cache.delete(key);
  }
}
