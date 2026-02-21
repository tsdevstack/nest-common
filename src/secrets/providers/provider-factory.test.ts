import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

// Mock provider classes
rs.mock('./gcp.provider', () => ({
  GCPSecretsProvider: rs.fn(),
}));

rs.mock('./aws.provider', () => ({
  AWSSecretsProvider: rs.fn(),
}));

rs.mock('./azure.provider', () => ({
  AzureSecretsProvider: rs.fn(),
}));

import { SecretsProviderFactory } from './provider-factory';
import { GCPSecretsProvider } from './gcp.provider';
import { AWSSecretsProvider } from './aws.provider';
import { AzureSecretsProvider } from './azure.provider';

describe('SecretsProviderFactory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createProvider', () => {
    describe('local provider', () => {
      it('should return null for local provider', () => {
        process.env.SECRETS_PROVIDER = 'local';

        const result = SecretsProviderFactory.createProvider('test-service');

        expect(result).toBeNull();
      });

      it('should default to local when SECRETS_PROVIDER is not set', () => {
        delete process.env.SECRETS_PROVIDER;

        const result = SecretsProviderFactory.createProvider('test-service');

        expect(result).toBeNull();
      });
    });

    describe('GCP provider', () => {
      it('should create GCP provider when configured', () => {
        process.env.SECRETS_PROVIDER = 'gcp';
        process.env.PROJECT_NAME = 'test-project';
        process.env.GCP_PROJECT_ID = 'my-gcp-project';
        process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';

        SecretsProviderFactory.createProvider('test-service');

        expect(GCPSecretsProvider).toHaveBeenCalledWith(
          expect.objectContaining({
            projectName: 'test-project',
            serviceName: 'test-service',
          }),
        );
      });

      it('should throw error when GCP_PROJECT_ID is missing', () => {
        process.env.SECRETS_PROVIDER = 'gcp';
        process.env.PROJECT_NAME = 'test-project';
        process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';
        delete process.env.GCP_PROJECT_ID;

        expect(() =>
          SecretsProviderFactory.createProvider('test-service'),
        ).toThrow('Missing required environment variables for GCP');
      });

      it('should throw error when GOOGLE_APPLICATION_CREDENTIALS is missing (not on Cloud Run)', () => {
        process.env.SECRETS_PROVIDER = 'gcp';
        process.env.PROJECT_NAME = 'test-project';
        process.env.GCP_PROJECT_ID = 'my-gcp-project';
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
        delete process.env.K_SERVICE;

        expect(() =>
          SecretsProviderFactory.createProvider('test-service'),
        ).toThrow('Missing required environment variables for GCP');
      });

      it('should skip GOOGLE_APPLICATION_CREDENTIALS check on Cloud Run (K_SERVICE set)', () => {
        process.env.SECRETS_PROVIDER = 'gcp';
        process.env.PROJECT_NAME = 'test-project';
        process.env.GCP_PROJECT_ID = 'my-gcp-project';
        process.env.K_SERVICE = 'auth-service';
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

        SecretsProviderFactory.createProvider('test-service');

        expect(GCPSecretsProvider).toHaveBeenCalledWith(
          expect.objectContaining({
            projectName: 'test-project',
            serviceName: 'test-service',
          }),
        );
      });
    });

    describe('AWS provider', () => {
      it('should create AWS provider when configured', () => {
        process.env.SECRETS_PROVIDER = 'aws';
        process.env.PROJECT_NAME = 'test-project';
        process.env.AWS_ACCESS_KEY_ID = 'key-id';
        process.env.AWS_SECRET_ACCESS_KEY = 'secret-key';
        process.env.AWS_REGION = 'us-east-1';

        SecretsProviderFactory.createProvider('test-service');

        expect(AWSSecretsProvider).toHaveBeenCalledWith(
          expect.objectContaining({
            projectName: 'test-project',
            serviceName: 'test-service',
          }),
        );
      });

      it('should throw error when AWS credentials are missing', () => {
        process.env.SECRETS_PROVIDER = 'aws';
        process.env.PROJECT_NAME = 'test-project';
        delete process.env.AWS_ACCESS_KEY_ID;
        delete process.env.AWS_SECRET_ACCESS_KEY;
        delete process.env.AWS_REGION;

        expect(() =>
          SecretsProviderFactory.createProvider('test-service'),
        ).toThrow('Missing required environment variables for AWS');
      });

      it('should throw error when only some AWS credentials are set', () => {
        process.env.SECRETS_PROVIDER = 'aws';
        process.env.PROJECT_NAME = 'test-project';
        process.env.AWS_ACCESS_KEY_ID = 'key-id';
        delete process.env.AWS_SECRET_ACCESS_KEY;
        delete process.env.AWS_REGION;

        expect(() =>
          SecretsProviderFactory.createProvider('test-service'),
        ).toThrow('Missing required environment variables for AWS');
      });
    });

    describe('Azure provider', () => {
      it('should create Azure provider when configured', () => {
        process.env.SECRETS_PROVIDER = 'azure';
        process.env.PROJECT_NAME = 'test-project';
        process.env.AZURE_CLIENT_ID = 'client-id';
        process.env.AZURE_CLIENT_SECRET = 'client-secret';
        process.env.AZURE_TENANT_ID = 'tenant-id';
        process.env.AZURE_KEYVAULT_NAME = 'keyvault-name';

        SecretsProviderFactory.createProvider('test-service');

        expect(AzureSecretsProvider).toHaveBeenCalledWith(
          expect.objectContaining({
            projectName: 'test-project',
            serviceName: 'test-service',
          }),
        );
      });

      it('should throw error when Azure credentials are missing', () => {
        process.env.SECRETS_PROVIDER = 'azure';
        process.env.PROJECT_NAME = 'test-project';
        delete process.env.AZURE_CLIENT_ID;
        delete process.env.AZURE_CLIENT_SECRET;
        delete process.env.AZURE_TENANT_ID;
        delete process.env.AZURE_KEYVAULT_NAME;

        expect(() =>
          SecretsProviderFactory.createProvider('test-service'),
        ).toThrow('Missing required environment variables for AZURE');
      });
    });

    describe('PROJECT_NAME validation', () => {
      it('should throw error when PROJECT_NAME is missing for cloud providers', () => {
        process.env.SECRETS_PROVIDER = 'gcp';
        process.env.GCP_PROJECT_ID = 'my-gcp-project';
        process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';
        delete process.env.PROJECT_NAME;

        expect(() =>
          SecretsProviderFactory.createProvider('test-service'),
        ).toThrow('PROJECT_NAME environment variable is required');
      });
    });

    describe('invalid provider', () => {
      it('should throw error for unknown provider type', () => {
        process.env.SECRETS_PROVIDER = 'invalid';
        process.env.PROJECT_NAME = 'test-project';

        expect(() =>
          SecretsProviderFactory.createProvider('test-service'),
        ).toThrow('Invalid SECRETS_PROVIDER');
      });
    });

    describe('case insensitivity', () => {
      it('should handle uppercase provider name', () => {
        process.env.SECRETS_PROVIDER = 'LOCAL';

        const result = SecretsProviderFactory.createProvider('test-service');

        expect(result).toBeNull();
      });

      it('should handle mixed case provider name', () => {
        process.env.SECRETS_PROVIDER = 'GcP';
        process.env.PROJECT_NAME = 'test-project';
        process.env.GCP_PROJECT_ID = 'my-gcp-project';
        process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';

        SecretsProviderFactory.createProvider('test-service');

        expect(GCPSecretsProvider).toHaveBeenCalled();
      });
    });
  });
});
