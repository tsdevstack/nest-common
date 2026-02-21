import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { NotificationService } from './notification.service';
import type { EmailProvider } from './providers/email-provider.interface';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockEmailProvider: EmailProvider;

  beforeEach(() => {
    mockEmailProvider = {
      send: rs.fn().mockResolvedValue(undefined),
      getName: rs.fn().mockReturnValue('mock'),
    };

    service = new NotificationService(mockEmailProvider);
  });

  describe('sendEmail', () => {
    it('should call email provider with options', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<h1>Hello</h1>',
      };

      await service.sendEmail(options);

      expect(mockEmailProvider.send).toHaveBeenCalledWith(options);
    });

    it('should pass through all email options', async () => {
      const options = {
        to: ['user1@example.com', 'user2@example.com'],
        subject: 'Multi-recipient',
        html: '<p>HTML content</p>',
        text: 'Text fallback',
        from: 'sender@example.com',
        replyTo: 'reply@example.com',
      };

      await service.sendEmail(options);

      expect(mockEmailProvider.send).toHaveBeenCalledWith(options);
    });

    it('should propagate provider errors', async () => {
      const error = new Error('Provider error');
      rs.mocked(mockEmailProvider.send).mockRejectedValue(error);

      await expect(
        service.sendEmail({ to: 'test@example.com', subject: 'Test' }),
      ).rejects.toThrow('Provider error');
    });
  });

  describe('sendSMS', () => {
    it('should throw not implemented error', async () => {
      await expect(
        service.sendSMS({ to: '+1234567890', body: 'Hello' }),
      ).rejects.toThrow('SMS notifications are not implemented');
    });
  });

  describe('sendPush', () => {
    it('should throw not implemented error', async () => {
      await expect(
        service.sendPush({ tokens: ['token1'], title: 'Title', body: 'Body' }),
      ).rejects.toThrow('Push notifications are not implemented');
    });
  });

  describe('getEmailProviderName', () => {
    it('should return the provider name', () => {
      expect(service.getEmailProviderName()).toBe('mock');
      expect(mockEmailProvider.getName).toHaveBeenCalled();
    });
  });
});
