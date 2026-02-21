import {
  CloudSecretsProvider,
  CloudProviderConfig,
} from './cloud-provider.interface';
import { GCPSecretsProvider } from './gcp.provider';
import { AWSSecretsProvider } from './aws.provider';
import { AzureSecretsProvider } from './azure.provider';

export type SecretsProviderType = 'local' | 'gcp' | 'aws' | 'azure';

/**
 * Factory for creating cloud secrets providers
 *
 * IMPORTANT: This runtime factory ONLY reads environment variables.
 * It does NOT read files or configs. All configuration must be set via env vars.
 *
 * Required environment variables:
 * - SECRETS_PROVIDER: 'local' | 'gcp' | 'aws' | 'azure'
 * - PROJECT_NAME: Your project name (required for cloud providers)
 * - SERVICE_NAME: Set by bootstrap
 *
 * Provider-specific env vars:
 * - GCP: GCP_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS (or K_SERVICE on Cloud Run)
 * - AWS: AWS_REGION (credentials from task role on ECS, or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)
 * - Azure: AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID, AZURE_KEYVAULT_NAME
 *
 * The CLI (cloud:init, cloud-secrets:*) handles all file operations.
 * Runtime just reads env vars and fails fast if missing.
 */
export class SecretsProviderFactory {
  /**
   * Create a secrets provider based on environment variables ONLY
   */
  static createProvider(serviceName: string): CloudSecretsProvider | null {
    const providerType = this.getProviderType();

    // Local provider is handled by the existing local file implementation
    // Return null to indicate "use local files"
    if (providerType === 'local') {
      return null;
    }

    const projectName = this.getProjectName();

    // For cloud providers, validate required env vars immediately
    this.validateProviderEnvVars(providerType);

    const config: CloudProviderConfig = {
      projectName,
      serviceName,
      providerConfig: {}, // Providers read their own env vars directly
    };

    switch (providerType) {
      case 'gcp':
        return new GCPSecretsProvider(config);
      case 'aws':
        return new AWSSecretsProvider(config);
      case 'azure':
        return new AzureSecretsProvider(config);
      default:
        throw new Error(`Unknown secrets provider type: ${providerType}`);
    }
  }

  /**
   * Get provider type from environment variable ONLY
   */
  private static getProviderType(): SecretsProviderType {
    const provider = process.env.SECRETS_PROVIDER?.toLowerCase();

    if (!provider) {
      // Default to local in development
      return 'local';
    }

    if (!['local', 'gcp', 'aws', 'azure'].includes(provider)) {
      throw new Error(
        `Invalid SECRETS_PROVIDER: ${provider}. Must be one of: local, gcp, aws, azure`,
      );
    }

    return provider as SecretsProviderType;
  }

  /**
   * Get project name from environment variable ONLY
   */
  private static getProjectName(): string {
    const projectName = process.env.PROJECT_NAME;

    if (!projectName) {
      throw new Error(
        'PROJECT_NAME environment variable is required for cloud secrets providers. ' +
          'Set it in your deployment configuration or .env file.',
      );
    }

    return projectName;
  }

  /**
   * Validate provider-specific environment variables
   */
  private static validateProviderEnvVars(provider: SecretsProviderType): void {
    const missing: string[] = [];

    switch (provider) {
      case 'gcp':
        // GCP project ID is always required
        if (!process.env.GCP_PROJECT_ID) {
          missing.push('GCP_PROJECT_ID');
        }
        // On Cloud Run, credentials come from the attached service account (ADC)
        // K_SERVICE is automatically set by Cloud Run
        if (
          !process.env.K_SERVICE &&
          !process.env.GOOGLE_APPLICATION_CREDENTIALS
        ) {
          missing.push('GOOGLE_APPLICATION_CREDENTIALS');
        }
        break;

      case 'aws':
        // AWS region is always required
        if (!process.env.AWS_REGION) missing.push('AWS_REGION');
        // On ECS Fargate, credentials come from the task role (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI)
        // Only require explicit credentials if NOT running on ECS
        if (
          !process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI &&
          !process.env.AWS_ACCESS_KEY_ID
        ) {
          missing.push('AWS_ACCESS_KEY_ID');
        }
        if (
          !process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI &&
          !process.env.AWS_SECRET_ACCESS_KEY
        ) {
          missing.push('AWS_SECRET_ACCESS_KEY');
        }
        break;

      case 'azure':
        if (!process.env.AZURE_CLIENT_ID) missing.push('AZURE_CLIENT_ID');
        if (!process.env.AZURE_CLIENT_SECRET)
          missing.push('AZURE_CLIENT_SECRET');
        if (!process.env.AZURE_TENANT_ID) missing.push('AZURE_TENANT_ID');
        if (!process.env.AZURE_KEYVAULT_NAME)
          missing.push('AZURE_KEYVAULT_NAME');
        break;
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables for ${provider.toUpperCase()}: ${missing.join(', ')}. ` +
          'Set these in your deployment configuration or .env file.',
      );
    }
  }
}
