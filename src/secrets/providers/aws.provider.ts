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
    let value = await this.fetchSecretFromAWS(serviceScopedName);

    // Fall back to shared scope if service-scoped doesn't exist
    if (value === null) {
      const sharedScopedName = this.buildSecretName(key, 'shared');
      value = await this.fetchSecretFromAWS(sharedScopedName);
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
      );
    }
  }

  /**
   * List all secrets for this service (both service-scoped and shared)
   */
  async list(): Promise<string[]> {
    const secrets: string[] = [];
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
              // Extract the key from the secret name
              // Format: {projectName}-{scope}-{KEY}
              const key = this.extractKeyFromSecretName(secret.Name);
              secrets.push(key);
            }
          }
        }

        nextToken = response.NextToken;
      } while (nextToken);

      return secrets;
    } catch (error) {
      throw new Error(
        `Failed to list secrets from AWS: ${error instanceof Error ? error.message : String(error)}`,
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
      await this.client.send(
        new DescribeSecretCommand({ SecretId: serviceScopedName }),
      );
      return true;
    } catch {
      // Secret doesn't exist, check shared scope
    }

    // Check shared scope
    const sharedScopedName = this.buildSecretName(key, 'shared');

    try {
      await this.client.send(
        new DescribeSecretCommand({ SecretId: sharedScopedName }),
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
   * Extract key from secret name
   * Input: "tsdevstack-auth-service-DATABASE_URL" or "tsdevstack-shared-DATABASE_URL"
   * Output: "DATABASE_URL"
   */
  private extractKeyFromSecretName(secretName: string): string {
    // Remove the project name prefix first
    const withoutProject = secretName.substring(this.projectName.length + 1);

    // Now remove the scope (either serviceName or 'shared')
    // Check if it starts with the service name
    if (withoutProject.startsWith(`${this.serviceName}-`)) {
      return withoutProject.substring(this.serviceName.length + 1);
    }

    // Otherwise assume it's shared scope
    if (withoutProject.startsWith('shared-')) {
      return withoutProject.substring('shared-'.length);
    }

    // Fallback: just return the remaining part after first dash
    const firstDashIndex = withoutProject.indexOf('-');
    return firstDashIndex >= 0 ? withoutProject.substring(firstDashIndex + 1) : withoutProject;
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
  private buildTags(metadata?: Record<string, string>): Array<{ Key: string; Value: string }> {
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