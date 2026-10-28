import { Logger } from '@nestjs/common';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import {
  CloudSecretsProvider,
  CloudProviderConfig,
} from './cloud-provider.interface';
import { GCP_SECRET_NOT_FOUND_CODE } from '../secrets.constants';

export class GCPSecretsProvider implements CloudSecretsProvider {
  private readonly logger = new Logger('GCPSecretsProvider');
  private client: SecretManagerServiceClient;
  private projectName: string;
  private serviceName: string;
  private gcpProjectId: string;

  constructor(config: CloudProviderConfig) {
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

    this.logger.debug(
      `Initializing for project ${this.gcpProjectId}, service ${this.serviceName}`,
    );

    // Initialize GCP Secret Manager client
    // Credentials are automatically loaded from:
    // 1. GOOGLE_APPLICATION_CREDENTIALS env var (pointing to credentials JSON)
    // 2. Application Default Credentials (ADC) in cloud environments
    this.client = new SecretManagerServiceClient();
  }

  /**
   * Read the latest version of {project}-{scope}-{key}
   */
  async read(key: string, scope: string): Promise<string | null> {
    const secretId = this.buildSecretName(key, scope);
    const versionName = `projects/${this.gcpProjectId}/secrets/${secretId}/versions/latest`;

    try {
      const [version] = await this.client.accessSecretVersion({
        name: versionName,
      });

      if (!version.payload?.data) {
        return null;
      }

      return version.payload.data.toString();
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw new Error(
        `Failed to read secret ${secretId} from GCP: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
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

  private isNotFound(error: unknown): boolean {
    return (error as { code?: number })?.code === GCP_SECRET_NOT_FOUND_CODE;
  }
}
