/**
 * The same cases against the local provider and the three cloud providers
 * (real provider classes, mocked SDKs): a service must read the same values
 * everywhere. The cloud store holds what `cloud-secrets:push` writes: every
 * service's API key in the shared scope as {SERVICE}_API_KEY, no
 * service-scoped API_KEY; plus a key set in both scopes and one only in a
 * service's scope.
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

const { CLOUD, isDenied } = rs.hoisted(() => ({
  CLOUD: {
    'shop-shared-AUTH_SERVICE_API_KEY': 'auth-key',
    'shop-shared-OFFERS_SERVICE_API_KEY': 'offers-key',
    'shop-shared-KONG_TRUST_TOKEN': 'trust-token',
    'shop-shared-LOG_LEVEL': 'info',
    'shop-auth-service-LOG_LEVEL': 'debug',
    'shop-auth-service-ADMIN_EMAILS': 'admin@shop.test',
  } as Record<string, string>,
  // The identity of `locked-service` may not read its own scope (a broken
  // IAM rule): every cloud must report that, not a missing secret
  isDenied: (id: string): boolean =>
    id.replace(/-/g, '_').startsWith('shop_locked_service_'),
}));

rs.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: class {
    accessSecretVersion = async ({ name }: { name: string }) => {
      const id = name.split('/secrets/')[1].split('/versions/')[0];
      if (isDenied(id)) {
        throw Object.assign(new Error('PERMISSION_DENIED'), { code: 7 });
      }
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
      if (isDenied(id)) {
        throw Object.assign(new Error('access denied'), {
          name: 'AccessDeniedException',
        });
      }
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
}));

rs.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class {
    // Key Vault names use hyphens for underscores
    getSecret = async (name: string) => {
      if (isDenied(name)) {
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
      }
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
  ManagedIdentityCredential: class {},
}));

// What generate-secrets writes locally: shared values at the top level,
// each service's own in its section
const LOCAL_FILE = {
  secrets: {
    AUTH_SERVICE_API_KEY: 'auth-key',
    OFFERS_SERVICE_API_KEY: 'offers-key',
    KONG_TRUST_TOKEN: 'trust-token',
    LOG_LEVEL: 'info',
  },
  'auth-service': {
    PORT: '3001',
    API_KEY: 'auth-key',
    LOG_LEVEL: 'debug',
    ADMIN_EMAILS: 'admin@shop.test',
    secrets: [],
  },
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
      new CloudProviderAdapter(new GCPSecretsProvider(providerConfig(name))),
    aws: (name) =>
      new CloudProviderAdapter(new AWSSecretsProvider(providerConfig(name))),
    azure: (name) =>
      new CloudProviderAdapter(new AzureSecretsProvider(providerConfig(name))),
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

      it("should prefer the service's own value over the shared one", async () => {
        await expect(service('auth-service').get('LOG_LEVEL')).resolves.toBe(
          'debug',
        );
        await expect(service('offers-service').get('LOG_LEVEL')).resolves.toBe(
          'info',
        );
      });

      it("should read a key only the service's own scope has", async () => {
        await expect(service('auth-service').get('ADMIN_EMAILS')).resolves.toBe(
          'admin@shop.test',
        );
      });

      it("should not read another service's scope", async () => {
        await expect(
          service('offers-service').get('ADMIN_EMAILS'),
        ).rejects.toThrow(
          `Secret "ADMIN_EMAILS" not found in ${provider} for service "offers-service" or the shared scope.`,
        );
      });

      if (provider !== 'local') {
        it('should report a denied read, not a missing secret', async () => {
          await expect(
            service('locked-service').get('KONG_TRUST_TOKEN'),
          ).rejects.toThrow(/^Failed to read secret shop-locked-service-KONG/);
        });
      }
    });
  }
});
