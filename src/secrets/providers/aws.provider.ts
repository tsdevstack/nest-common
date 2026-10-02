import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  PutSecretValueCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  ListSecretsCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  CloudSecretsProvider,
  CloudProviderConfig,
  CacheEntry,
} from './cloud-provider.interface';
import { extractScopedSecretKey } from './extract-scoped-secret-key';
import { CLOUD_SECRET_KEY_PATTERN } from '../secrets.constants';

export class AWSSecretsProvider implements CloudSecretsProvider {
  private client: SecretsManagerClient;
  private projectName: string;
  private serviceName: string;
  private region: string;
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: CloudProviderConfig) {
    this.projectName = config.projectName;
    this.serviceName = config.serviceName;
    this.region = (config.providerConfig?.region as string) || 'us-east-1';

    // Initialize AWS Secrets Manager client
    // Credentials are automatically loaded from:
    // 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION)
    // 2. AWS credentials file (~/.aws/credentials)
    // 3. IAM role (in AWS environments)
    this.client = new SecretsManagerClient({
      region: this.region,
    });
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
    let value = await this.fetchSecretFromAWS(sharedScopedName);

    // Fall back to service scope for explicitly scoped secrets
    if (value === null) {
      const serviceScopedName = this.buildSecretName(key, this.serviceName);
      value = await this.fetchSecretFromAWS(serviceScopedName);
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
      // Check if secret exists
      const secretExists = await this.exists(key);

      if (!secretExists) {
        // Create new secret with tags
        await this.client.send(
          new CreateSecretCommand({
            Name: secretName,
            SecretString: value,
            Tags: this.buildTags(metadata),
          }),
        );
      } else {
        // Update existing secret
        await this.client.send(
          new PutSecretValueCommand({
            SecretId: secretName,
            SecretString: value,
          }),
        );
      }

      // Invalidate cache
      this.invalidateCache(key);
    } catch (error) {
      throw new Error(
        `Failed to set secret ${secretName} in AWS: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Remove a secret
   */
  async remove(key: string): Promise<void> {
    const secretName = this.buildSecretName(key, this.serviceName);

    try {
      await this.client.send(
        new DeleteSecretCommand({
          SecretId: secretName,
          ForceDeleteWithoutRecovery: false,
          RecoveryWindowInDays: 7, // 7-day recovery window
        }),
      );

      // Invalidate cache
      this.invalidateCache(key);
    } catch (error) {
      throw new Error(
        `Failed to remove secret ${secretName} from AWS: ${error instanceof Error ? error.message : String(error)}`,
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
    let nextToken: string | undefined;

    try {
      do {
        const response = await this.client.send(
          new ListSecretsCommand({
            Filters: [
              {
                Key: 'tag-key',
                Values: ['project-name'],
              },
              {
                Key: 'tag-value',
                Values: [this.projectName],
              },
            ],
            NextToken: nextToken,
          }),
        );

        if (response.SecretList) {
          for (const secret of response.SecretList) {
            if (secret.Name) {
              // Format: {projectName}-{scope}-{KEY}
              const key = extractScopedSecretKey(
                secret.Name,
                scopePrefixes,
                CLOUD_SECRET_KEY_PATTERN,
              );
              if (key !== null) {
                keys.add(key);
              }
            }
          }
        }

        nextToken = response.NextToken;
      } while (nextToken);

      return [...keys];
    } catch (error) {
      throw new Error(
        `Failed to list secrets from AWS: ${error instanceof Error ? error.message : String(error)}`,
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
      await this.client.send(
        new DescribeSecretCommand({ SecretId: sharedScopedName }),
      );
      return true;
    } catch {
      // Secret doesn't exist, check service scope
    }

    // Check service scope
    const serviceScopedName = this.buildSecretName(key, this.serviceName);

    try {
      await this.client.send(
        new DescribeSecretCommand({ SecretId: serviceScopedName }),
      );
      return true;
    } catch {
      return false;
    }
  }

  getProviderName(): string {
    return 'aws';
  }

  /**
   * Build secret name following convention: {projectName}-{scope}-{KEY}
   */
  private buildSecretName(key: string, scope: string): string {
    return `${this.projectName}-${scope}-${key}`;
  }

  /**
   * Name prefixes of the scopes list() returns: shared, and this service when
   * a service name is set. Built like the names get() reads.
   */
  private buildScopePrefixes(): string[] {
    const scopes = this.serviceName ? ['shared', this.serviceName] : ['shared'];
    return scopes.map((scope) => this.buildSecretName('', scope));
  }

  /**
   * Fetch secret value from AWS
   */
  private async fetchSecretFromAWS(secretName: string): Promise<string | null> {
    try {
      const response = await this.client.send(
        new GetSecretValueCommand({ SecretId: secretName }),
      );
      return response.SecretString || null;
    } catch {
      // Secret doesn't exist or access denied
      return null;
    }
  }

  /**
   * Build AWS tags from metadata
   * AWS supports up to 50 tags per secret
   */
  private buildTags(
    metadata?: Record<string, string>,
  ): Array<{ Key: string; Value: string }> {
    const tags: Array<{ Key: string; Value: string }> = [
      { Key: 'project-name', Value: this.projectName },
      { Key: 'service-name', Value: this.serviceName },
      { Key: 'managed-by', Value: 'tsdevstack' },
    ];

    if (metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        tags.push({ Key: key, Value: value });
      }
    }

    return tags;
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
