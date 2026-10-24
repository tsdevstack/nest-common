/**
 * The same cases against the local provider and the three cloud providers
 * (real provider classes, mocked SDKs): a service must read the same values
 * everywhere. The cloud store holds what `cloud-secrets:push` writes: every
 * service's API key in the shared scope as {SERVICE}_API_KEY, no
 * service-scoped API_KEY.
 */
import { describe, it, expect, rs, beforeAll, afterAll } from '@rstest/core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SecretsService } from './secrets.service';
import { CloudProviderAdapter } from './providers/cloud-provider-adapter';
import { GCPSecretsProvider } from './providers/gcp.provider';
import { AWSSecretsProvider } from './providers/aws.provider';
import { AzureSecretsProvider } from './providers/azure.provider';
import { LocalSecretsProvider } from './providers/local.provider';
import type { SecretsProvider } from './secrets.interface';

const { CLOUD } = rs.hoisted(() => ({
  CLOUD: {
    'shop-shared-AUTH_SERVICE_API_KEY': 'auth-key',
    'shop-shared-OFFERS_SERVICE_API_KEY': 'offers-key',
    'shop-shared-KONG_TRUST_TOKEN': 'trust-token',
  } as Record<string, string>,
}));

rs.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: class {
    accessSecretVersion = async ({ name }: { name: string }) => {
      const id = name.split('/secrets/')[1].split('/versions/')[0];
      if (!(id in CLOUD)) {
        throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
      }
      return [{ payload: { data: Buffer.from(CLOUD[id]) } }];
    };
  },
}));

rs.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = async (command: { input: { SecretId: string } }) => {
      const id = command.input.SecretId;
      if (!(id in CLOUD)) {
        throw Object.assign(new Error('not found'), {
          name: 'ResourceNotFoundException',
        });
      }
      return { SecretString: CLOUD[id] };
    };
  },
  GetSecretValueCommand: class {
    constructor(readonly input: unknown) {}
  },
  CreateSecretCommand: class {},
  PutSecretValueCommand: class {},
  DeleteSecretCommand: class {},
  DescribeSecretCommand: class {},
}));

rs.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class {
    // Key Vault names use hyphens for underscores
    getSecret = async (name: string) => {
      const id = Object.keys(CLOUD).find((k) => k.replace(/_/g, '-') === name);
      if (!id) {
        throw Object.assign(new Error('SecretNotFound'), { statusCode: 404 });
      }
      return { value: CLOUD[id] };
    };
  },
}));

rs.mock('@azure/identity', () => ({
  ClientSecretCredential: class {},
  DefaultAzureCredential: class {},
}));

// What generate-secrets writes locally: values at the top level
const LOCAL_FILE = {
  secrets: {
    AUTH_SERVICE_API_KEY: 'auth-key',
    OFFERS_SERVICE_API_KEY: 'offers-key',
    KONG_TRUST_TOKEN: 'trust-token',
  },
  'auth-service': { PORT: '3001', API_KEY: 'auth-key', secrets: [] },
};

describe('SecretsService on every provider', () => {
  let localDir: string;

  beforeAll(() => {
    localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsd-secrets-'));
    fs.writeFileSync(
      path.join(localDir, '.secrets.local.json'),
      JSON.stringify(LOCAL_FILE),
    );
    process.env.AZURE_TENANT_ID = 'tenant';
    process.env.AZURE_CLIENT_ID = 'client';
    process.env.AZURE_CLIENT_SECRET = 'secret';
  });

  afterAll(() => {
    fs.rmSync(localDir, { recursive: true, force: true });
  });

  const providerConfig = (serviceName: string) => ({
    projectName: 'shop',
    serviceName,
    providerConfig: {
      projectId: 'shop-dev',
      keyVaultName: 'shop-dev-kv',
      region: 'us-east-1',
    },
  });

  const providers: Record<string, (serviceName: string) => SecretsProvider> = {
    local: () => {
      const cwd = rs.spyOn(process, 'cwd').mockReturnValue(localDir);
      const provider = new LocalSecretsProvider();
      cwd.mockRestore();
      return provider;
    },
    gcp: (name) =>
      new CloudProviderAdapter(
        new GCPSecretsProvider(providerConfig(name)),
        name,
      ),
    aws: (name) =>
      new CloudProviderAdapter(
        new AWSSecretsProvider(providerConfig(name)),
        name,
      ),
    azure: (name) =>
      new CloudProviderAdapter(
        new AzureSecretsProvider(providerConfig(name)),
        name,
      ),
  };

  for (const [provider, create] of Object.entries(providers)) {
    describe(provider, () => {
      const service = (serviceName: string): SecretsService =>
        new SecretsService({
          serviceName,
          forceProvider: create(serviceName),
        });

      it("should read API_KEY as the service's own key", async () => {
        await expect(service('auth-service').get('API_KEY')).resolves.toBe(
          'auth-key',
        );
        await expect(service('offers-service').get('API_KEY')).resolves.toBe(
          'offers-key',
        );
      });

      it("should read another service's key by its name", async () => {
        await expect(
          service('bff-service').get('AUTH_SERVICE_API_KEY'),
        ).resolves.toBe('auth-key');
      });

      it('should read a shared secret', async () => {
        await expect(
          service('offers-service').get('KONG_TRUST_TOKEN'),
        ).resolves.toBe('trust-token');
      });
    });
  }
});
