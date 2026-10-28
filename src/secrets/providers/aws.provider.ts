import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  CloudSecretsProvider,
  CloudProviderConfig,
} from './cloud-provider.interface';
import { AWS_SECRET_NOT_FOUND_ERRORS } from '../secrets.constants';

export class AWSSecretsProvider implements CloudSecretsProvider {
  private client: SecretsManagerClient;
  private projectName: string;
  private region: string;

  constructor(config: CloudProviderConfig) {
    this.projectName = config.projectName;
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
   * Read {project}-{scope}-{key}
   */
  async read(key: string, scope: string): Promise<string | null> {
    const secretName = this.buildSecretName(key, scope);

    try {
      const response = await this.client.send(
        new GetSecretValueCommand({ SecretId: secretName }),
      );
      return response.SecretString ?? null;
    } catch (error) {
      if (AWS_SECRET_NOT_FOUND_ERRORS.includes(this.errorName(error))) {
        return null;
      }
      throw new Error(
        `Failed to read secret ${secretName} from AWS: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
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

  private errorName(error: unknown): string {
    return (error as { name?: string })?.name ?? '';
  }
}
