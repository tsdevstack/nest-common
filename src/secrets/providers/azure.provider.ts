import { SecretClient } from '@azure/keyvault-secrets';
import {
  DefaultAzureCredential,
  ClientSecretCredential,
  ManagedIdentityCredential,
} from '@azure/identity';
import type { TokenCredential } from '@azure/identity';
import {
  CloudSecretsProvider,
  CloudProviderConfig,
} from './cloud-provider.interface';
import {
  AZURE_SECRET_NOT_FOUND_STATUS,
  SHARED_SECRETS_SCOPE,
} from '../secrets.constants';

/**
 * Azure Key Vault secrets provider
 *
 * The shared scope lives in the shared vault (AZURE_KEYVAULT_NAME), the
 * service's own scope in its own vault (AZURE_SERVICE_KEYVAULT_NAME). The
 * service reads both with its own identity (AZURE_SECRETS_CLIENT_ID), which
 * has access to these two vaults only.
 *
 * Without AZURE_SERVICE_KEYVAULT_NAME (a container deployed by an older CLI)
 * the service's scope is read from the shared vault, where it lived then.
 */
export class AzureSecretsProvider implements CloudSecretsProvider {
  private sharedClient: SecretClient;
  private serviceClient: SecretClient;
  private projectName: string;
  private serviceName: string;
  private keyVaultName: string;

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

    const credential = this.createCredential();
    this.sharedClient = this.createClient(this.keyVaultName, credential);

    const serviceKeyVaultName =
      process.env.AZURE_SERVICE_KEYVAULT_NAME ||
      (config.providerConfig?.serviceKeyVaultName as string | undefined);
    this.serviceClient = serviceKeyVaultName
      ? this.createClient(serviceKeyVaultName, credential)
      : this.sharedClient;
  }

  /**
   * Read {project}-{scope}-{key} (key with hyphens for underscores) from the
   * scope's vault
   */
  async read(key: string, scope: string): Promise<string | null> {
    const secretName = this.buildSecretName(key, scope);

    try {
      const secret = await this.clientFor(scope).getSecret(secretName);
      return secret.value ?? null;
    } catch (error) {
      if (
        (error as { statusCode?: number })?.statusCode ===
        AZURE_SECRET_NOT_FOUND_STATUS
      ) {
        return null;
      }
      throw new Error(
        `Failed to read secret ${secretName} from Azure: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  getProviderName(): string {
    return 'azure';
  }

  /**
   * Credential strategy:
   * 1. AZURE_SECRETS_CLIENT_ID → the service's own managed identity (Container Apps)
   * 2. AZURE_CLIENT_SECRET with tenant and client → ClientSecretCredential (local dev)
   * 3. Otherwise → DefaultAzureCredential
   */
  private createCredential(): TokenCredential {
    const secretsClientId = process.env.AZURE_SECRETS_CLIENT_ID;
    if (secretsClientId) {
      return new ManagedIdentityCredential({ clientId: secretsClientId });
    }

    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    if (tenantId && clientId && clientSecret) {
      return new ClientSecretCredential(tenantId, clientId, clientSecret);
    }

    // DefaultAzureCredential picks up managed identity in Azure.
    // AZURE_CLIENT_ID selects the user-assigned identity.
    return new DefaultAzureCredential();
  }

  private createClient(
    vaultName: string,
    credential: TokenCredential,
  ): SecretClient {
    return new SecretClient(`https://${vaultName}.vault.azure.net`, credential);
  }

  /**
   * The vault of a scope. A service reads only its own scope and the shared one.
   */
  private clientFor(scope: string): SecretClient {
    if (scope === SHARED_SECRETS_SCOPE) {
      return this.sharedClient;
    }
    if (scope === this.serviceName) {
      return this.serviceClient;
    }
    throw new Error(
      `Service "${this.serviceName}" cannot read the secret scope "${scope}"`,
    );
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
   * Transform key to Azure-compatible format
   * Azure Key Vault only allows alphanumeric and hyphens
   * DATABASE_URL → DATABASE-URL
   */
  private transformKey(key: string): string {
    return key.replace(/_/g, '-');
  }
}
