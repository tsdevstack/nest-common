import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { AWSSecretsProvider } from './aws.provider';
import type { CloudProviderConfig } from './cloud-provider.interface';

// Mock the AWS SDK
const mockSend = rs.fn();

rs.mock('@aws-sdk/client-secrets-manager', () => {
  return {
    SecretsManagerClient: class {
      send = mockSend;
      config = { region: 'us-east-1' };
    },
    GetSecretValueCommand: rs.fn(),
  };
});

// What the SDK throws, by error name
const awsError = (name: string): Error =>
  Object.assign(new Error(name), { name });

describe('AWSSecretsProvider', () => {
  let provider: AWSSecretsProvider;

  beforeEach(() => {
    rs.clearAllMocks();
    mockSend.mockReset();

    const config: CloudProviderConfig = {
      projectName: 'testproject',
      serviceName: 'test-service',
      providerConfig: {
        region: 'us-east-1',
      },
    };

    provider = new AWSSecretsProvider(config);
  });

  describe('constructor', () => {
    it('should initialize with default region', () => {
      const config: CloudProviderConfig = {
        projectName: 'testproject',
        serviceName: 'test-service',
      };

      const provider = new AWSSecretsProvider(config);
      expect(provider).toBeDefined();
    });

    it('should initialize with custom region', () => {
      const config: CloudProviderConfig = {
        projectName: 'testproject',
        serviceName: 'test-service',
        providerConfig: {
          region: 'eu-west-1',
        },
      };

      const provider = new AWSSecretsProvider(config);
      expect(provider).toBeDefined();
    });
  });

  describe('read', () => {
    it('should read the exact name of the scope', async () => {
      mockSend.mockResolvedValue({ SecretString: 'shared-value' });

      const result = await provider.read('SOME_SECRET', 'shared');

      expect(result).toBe('shared-value');
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(GetSecretValueCommand).toHaveBeenCalledWith({
        SecretId: 'testproject-shared-SOME_SECRET',
      });
    });

    it("should read the service's own scope by its name", async () => {
      mockSend.mockResolvedValue({ SecretString: 'service-value' });

      await expect(provider.read('SOME_SECRET', 'test-service')).resolves.toBe(
        'service-value',
      );
      expect(GetSecretValueCommand).toHaveBeenCalledWith({
        SecretId: 'testproject-test-service-SOME_SECRET',
      });
    });

    it('should return null when the secret does not exist', async () => {
      mockSend.mockRejectedValue(awsError('ResourceNotFoundException'));

      await expect(provider.read('NONEXISTENT', 'shared')).resolves.toBeNull();
    });

    it('should return null when the secret is scheduled for deletion', async () => {
      mockSend.mockRejectedValue(awsError('InvalidRequestException'));

      await expect(
        provider.read('REMOVED', 'test-service'),
      ).resolves.toBeNull();
    });

    it('should throw, not report a missing secret, when access is denied', async () => {
      mockSend.mockRejectedValue(awsError('AccessDeniedException'));

      await expect(provider.read('KEY', 'shared')).rejects.toThrow(
        'Failed to read secret testproject-shared-KEY from AWS: AccessDeniedException',
      );
    });

    it('should return null when the secret has no string value', async () => {
      mockSend.mockResolvedValue({ SecretBinary: new Uint8Array([1]) });

      await expect(provider.read('BINARY', 'shared')).resolves.toBeNull();
    });
  });

  describe('getProviderName', () => {
    it('should return "aws"', () => {
      expect(provider.getProviderName()).toBe('aws');
    });
  });
});
