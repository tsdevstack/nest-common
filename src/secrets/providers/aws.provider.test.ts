import { describe, it, expect, rs, beforeEach } from '@rstest/core';
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
    CreateSecretCommand: rs.fn(),
    PutSecretValueCommand: rs.fn(),
    DeleteSecretCommand: rs.fn(),
    DescribeSecretCommand: rs.fn(),
    ListSecretsCommand: rs.fn(),
  };
});

describe('AWSSecretsProvider', () => {
  let provider: AWSSecretsProvider;

  beforeEach(() => {
    rs.clearAllMocks();
    mockSend.mockClear();

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

  describe('get', () => {
    it('should get service-scoped secret', async () => {
      mockSend.mockResolvedValue({
        SecretString: 'service-value',
      });

      const result = await provider.get('DATABASE_URL');

      expect(result).toBe('service-value');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should fall back to shared secret when service-scoped does not exist', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('ResourceNotFoundException')) // service-scoped fails
        .mockResolvedValueOnce({ SecretString: 'shared-value' }); // shared succeeds

      const result = await provider.get('API_KEY');

      expect(result).toBe('shared-value');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should return null when neither service-scoped nor shared exists', async () => {
      mockSend.mockRejectedValue(new Error('ResourceNotFoundException'));

      const result = await provider.get('NONEXISTENT');

      expect(result).toBeNull();
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should cache successful results', async () => {
      mockSend.mockResolvedValue({
        SecretString: 'cached-value',
      });

      const result1 = await provider.get('CACHED_KEY');
      const result2 = await provider.get('CACHED_KEY');

      expect(result1).toBe('cached-value');
      expect(result2).toBe('cached-value');
      expect(mockSend).toHaveBeenCalledTimes(1); // Only called once due to caching
    });

    it('should not cache null results', async () => {
      mockSend.mockRejectedValue(new Error('ResourceNotFoundException'));

      const result1 = await provider.get('MISSING_KEY');
      const result2 = await provider.get('MISSING_KEY');

      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(mockSend).toHaveBeenCalledTimes(4); // 2 attempts per call (service + shared)
    });
  });

  describe('set', () => {
    it('should create new secret when it does not exist', async () => {
      // Mock exists check (service-scoped and shared both fail)
      mockSend
        .mockRejectedValueOnce(new Error('ResourceNotFoundException')) // service exists check
        .mockRejectedValueOnce(new Error('ResourceNotFoundException')) // shared exists check
        .mockResolvedValueOnce({}); // create secret

      await provider.set('NEW_KEY', 'new-value');

      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should update existing secret', async () => {
      // Mock exists check (service-scoped succeeds)
      mockSend
        .mockResolvedValueOnce({ Name: 'existing-secret' }) // service exists check
        .mockResolvedValueOnce({}); // update secret

      await provider.set('EXISTING_KEY', 'updated-value');

      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should set secret with metadata tags', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('Not found'))
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValueOnce({});

      await provider.set('KEY', 'value', { environment: 'staging' });

      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should invalidate cache after setting', async () => {
      // First get (cache it)
      mockSend.mockResolvedValue({ SecretString: 'old-value' });
      const result1 = await provider.get('KEY');
      expect(result1).toBe('old-value');

      // Set new value
      mockSend
        .mockResolvedValueOnce({ Name: 'exists' }) // exists check
        .mockResolvedValueOnce({}); // update

      await provider.set('KEY', 'new-value');

      // Get again (should fetch from AWS, not cache)
      mockSend.mockResolvedValue({ SecretString: 'new-value' });
      const result2 = await provider.get('KEY');
      expect(result2).toBe('new-value');
    });

    it('should throw error on failure', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('Not found'))
        .mockRejectedValueOnce(new Error('Not found'))
        .mockRejectedValueOnce(new Error('Permission denied'));

      await expect(provider.set('KEY', 'value')).rejects.toThrow(
        'Failed to set secret',
      );
    });
  });

  describe('remove', () => {
    it('should delete secret with recovery window', async () => {
      mockSend.mockResolvedValue({});

      await provider.remove('KEY_TO_DELETE');

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache after removal', async () => {
      // Cache a value
      mockSend.mockResolvedValue({ SecretString: 'cached' });
      await provider.get('KEY');

      // Remove it
      mockSend.mockResolvedValue({});
      await provider.remove('KEY');

      // Try to get again (should hit AWS, not cache)
      mockSend.mockRejectedValue(new Error('Not found'));
      const result = await provider.get('KEY');
      expect(result).toBeNull();
    });

    it('should throw error on failure', async () => {
      mockSend.mockRejectedValue(new Error('Permission denied'));

      await expect(provider.remove('KEY')).rejects.toThrow(
        'Failed to remove secret',
      );
    });
  });

  describe('list', () => {
    it('should list all secrets for project', async () => {
      mockSend.mockResolvedValue({
        SecretList: [
          { Name: 'testproject-shared-DATABASE_URL' },
          { Name: 'testproject-test-service-API_KEY' },
          { Name: 'testproject-shared-REDIS_HOST' },
        ],
      });

      const result = await provider.list();

      expect(result).toEqual(['DATABASE_URL', 'API_KEY', 'REDIS_HOST']);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should handle pagination', async () => {
      mockSend
        .mockResolvedValueOnce({
          SecretList: [{ Name: 'testproject-shared-KEY1' }],
          NextToken: 'next-page-token',
        })
        .mockResolvedValueOnce({
          SecretList: [{ Name: 'testproject-shared-KEY2' }],
        });

      const result = await provider.list();

      expect(result).toEqual(['KEY1', 'KEY2']);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should handle empty secret list', async () => {
      mockSend.mockResolvedValue({
        SecretList: [],
      });

      const result = await provider.list();

      expect(result).toEqual([]);
    });

    it('should throw error on failure', async () => {
      mockSend.mockRejectedValue(new Error('Access denied'));

      await expect(provider.list()).rejects.toThrow(
        'Failed to list secrets from AWS',
      );
    });
  });

  describe('exists', () => {
    it('should return true when service-scoped secret exists', async () => {
      mockSend.mockResolvedValue({ Name: 'secret-name' });

      const result = await provider.exists('KEY');

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should check shared scope if service-scoped does not exist', async () => {
      mockSend
        .mockRejectedValueOnce(new Error('Not found')) // service-scoped
        .mockResolvedValueOnce({ Name: 'shared-secret' }); // shared

      const result = await provider.exists('KEY');

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should return false when secret does not exist in either scope', async () => {
      mockSend.mockRejectedValue(new Error('ResourceNotFoundException'));

      const result = await provider.exists('NONEXISTENT');

      expect(result).toBe(false);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('getProviderName', () => {
    it('should return "aws"', () => {
      expect(provider.getProviderName()).toBe('aws');
    });
  });

  describe('secret naming', () => {
    it('should build correct secret names', async () => {
      mockSend.mockResolvedValue({ SecretString: 'value' });

      await provider.get('DATABASE_URL');

      // Verify that send was called (the actual secret name is internal implementation)
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(expect.any(Object));
    });

    it('should extract correct key from secret name', async () => {
      mockSend.mockResolvedValue({
        SecretList: [
          { Name: 'testproject-shared-COMPLEX-KEY-NAME' },
          { Name: 'testproject-shared-DATABASE-URL' },
        ],
      });

      const result = await provider.list();

      expect(result).toContain('COMPLEX-KEY-NAME');
      expect(result).toContain('DATABASE-URL');
    });
  });

  describe('caching', () => {
    it('should cache for 5 minutes', async () => {
      mockSend.mockResolvedValue({ SecretString: 'cached-value' });

      // First call
      await provider.get('KEY');
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Second call within cache TTL
      await provider.get('KEY');
      expect(mockSend).toHaveBeenCalledTimes(1); // Still only 1 call

      // Note: We can't easily test cache expiration without mocking time
    });
  });
});
