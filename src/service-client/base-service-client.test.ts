import { describe, it, expect, rs, beforeEach } from '@rstest/core';

rs.mock('@nestjs/common', () => ({
  Injectable: () => (target: unknown) => target,
  Logger: class MockLogger {
    log = rs.fn();
    error = rs.fn();
  },
}));

import { BaseServiceClient } from './base-service-client';
import type { ServiceClientConfig } from './base-service-client';

// Concrete subclass for testing
class TestServiceClient extends BaseServiceClient<{ api: string }> {
  public doInitialize(config: ServiceClientConfig<{ api: string }>): void {
    this.initialize(config);
  }
}

describe('BaseServiceClient', () => {
  let client: TestServiceClient;

  beforeEach(() => {
    rs.clearAllMocks();
    client = new TestServiceClient();
  });

  describe('initialize', () => {
    it('should create client using factory function', () => {
      const mockCreateClient = rs.fn().mockReturnValue({ api: 'test' });

      client.doInitialize({
        baseURL: 'http://localhost:3000',
        apiKey: 'test-key',
        createClient: mockCreateClient,
      });

      expect(mockCreateClient).toHaveBeenCalledWith(
        'http://localhost:3000',
        'test-key',
      );
      expect(client.client).toEqual({ api: 'test' });
    });

    it('should throw if baseURL is missing', () => {
      expect(() =>
        client.doInitialize({
          baseURL: '',
          apiKey: 'test-key',
          createClient: rs.fn(),
        }),
      ).toThrow('Service base URL is required');
    });

    it('should throw if apiKey is missing', () => {
      expect(() =>
        client.doInitialize({
          baseURL: 'http://localhost:3000',
          apiKey: '',
          createClient: rs.fn(),
        }),
      ).toThrow('Service API key is required');
    });

    it('should rethrow errors from createClient', () => {
      const factory = rs.fn().mockImplementation(() => {
        throw new Error('Factory error');
      });

      expect(() =>
        client.doInitialize({
          baseURL: 'http://localhost:3000',
          apiKey: 'test-key',
          createClient: factory,
        }),
      ).toThrow('Factory error');
    });
  });
});
