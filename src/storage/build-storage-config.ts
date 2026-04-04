import type { SecretsService } from '../secrets/secrets.service';
import type {
  StorageAdapterType,
  StorageProviderConfig,
} from './providers/provider-factory';

export async function buildStorageConfig(
  secrets: Pick<SecretsService, 'get'>,
  adapter: StorageAdapterType,
): Promise<StorageProviderConfig> {
  switch (adapter) {
    case 's3': {
      const secretsProvider = process.env.SECRETS_PROVIDER;

      if (secretsProvider === 'local') {
        // MinIO: read connection details from secrets
        const endpoint = await secrets.get('STORAGE_ENDPOINT');
        const accessKey = await secrets.get('STORAGE_ACCESS_KEY');
        const secretKey = await secrets.get('STORAGE_SECRET_KEY');
        const forcePathStyle = await secrets.get('STORAGE_FORCE_PATH_STYLE');

        return {
          endpoint,
          credentials: { accessKey, secretKey },
          forcePathStyle: forcePathStyle === 'true',
        };
      }

      // AWS: IAM task roles handle auth automatically
      return {};
    }

    case 'gcs':
      // ADC handles auth — no config needed
      return {};

    case 'azure-blob': {
      const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;

      if (!accountName) {
        throw new Error(
          'AZURE_STORAGE_ACCOUNT_NAME environment variable is required for Azure Blob storage.',
        );
      }

      return { accountName };
    }

    default: {
      const exhaustive: never = adapter;
      throw new Error(`Unknown storage adapter: ${exhaustive}`);
    }
  }
}
