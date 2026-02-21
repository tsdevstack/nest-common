import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { ResendEmailProvider } from './resend.provider';
import type { SecretsService } from '../../../secrets/secrets.service';

// Mock Resend SDK
const mockSend = rs.fn();
rs.mock('resend', () => ({
  Resend: class MockResend {
    emails = {
      send: mockSend,
    };
  },
}));

describe('ResendEmailProvider', () => {
  let provider: ResendEmailProvider;
  let mockSecrets: SecretsService;

  beforeEach(() => {
    rs.clearAllMocks();

    mockSecrets = {
      get: rs.fn().mockImplementation((key: string) => {
        if (key === 'RESEND_API_KEY') return Promise.resolve('re_test_key');
        if (key === 'EMAIL_FROM') return Promise.resolve('test@example.com');
        return Promise.reject(new Error('Not found'));
      }),
    } as unknown as SecretsService;

    provider = new ResendEmailProvider(mockSecrets);
  });

  describe('onModuleInit', () => {
    it('should initialize with API key and default from address', async () => {
      await provider.onModuleInit();

      expect(mockSecrets.get).toHaveBeenCalledWith('RESEND_API_KEY');
      expect(mockSecrets.get).toHaveBeenCalledWith('EMAIL_FROM');
    });

    it('should use fallback from address when EMAIL_FROM not set', async () => {
      mockSecrets.get = rs.fn().mockImplementation((key: string) => {
        if (key === 'RESEND_API_KEY') return Promise.resolve('re_test_key');
        return Promise.reject(new Error('Not found'));
      });

      await provider.onModuleInit();

      // Should still initialize without throwing
      expect(mockSecrets.get).toHaveBeenCalledWith('EMAIL_FROM');
    });
  });

  describe('send', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValue({ data: { id: 'email_123' }, error: null });
      await provider.onModuleInit();
    });

    it('should send email with all options', async () => {
      await provider.send({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<h1>Hello</h1>',
        text: 'Hello',
        replyTo: 'reply@example.com',
      });

      expect(mockSend).toHaveBeenCalledWith({
        from: 'test@example.com',
        to: ['recipient@example.com'],
        subject: 'Test Subject',
        html: '<h1>Hello</h1>',
        text: 'Hello',
        replyTo: 'reply@example.com',
      });
    });

    it('should handle array of recipients', async () => {
      await provider.send({
        to: ['user1@example.com', 'user2@example.com'],
        subject: 'Multi-recipient',
        html: '<p>Hello all</p>',
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['user1@example.com', 'user2@example.com'],
        }),
      );
    });

    it('should use custom from address when provided', async () => {
      await provider.send({
        to: 'recipient@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
        from: 'custom@example.com',
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'custom@example.com',
        }),
      );
    });

    it('should throw error when Resend returns error', async () => {
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'Invalid API key' },
      });

      await expect(
        provider.send({
          to: 'recipient@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
        }),
      ).rejects.toThrow('Failed to send email: Invalid API key');
    });
  });

  describe('getName', () => {
    it('should return "resend"', () => {
      expect(provider.getName()).toBe('resend');
    });
  });
});
