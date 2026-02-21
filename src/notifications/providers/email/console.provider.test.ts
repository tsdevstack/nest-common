import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import { ConsoleEmailProvider } from './console.provider';

describe('ConsoleEmailProvider', () => {
  let provider: ConsoleEmailProvider;
  let consoleLogSpy: ReturnType<typeof rs.spyOn>;

  beforeEach(() => {
    provider = new ConsoleEmailProvider();
    // Mock console.log
    consoleLogSpy = rs.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('send', () => {
    it('should log email details to console', async () => {
      await provider.send({
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<h1>Hello</h1>',
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '\n========================================',
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '📧 EMAIL (console provider - not actually sent)',
      );
      expect(consoleLogSpy).toHaveBeenCalledWith('To:      test@example.com');
      expect(consoleLogSpy).toHaveBeenCalledWith('Subject: Test Subject');
      expect(consoleLogSpy).toHaveBeenCalledWith('Body:');
      expect(consoleLogSpy).toHaveBeenCalledWith('<h1>Hello</h1>');
    });

    it('should handle array of recipients', async () => {
      await provider.send({
        to: ['user1@example.com', 'user2@example.com'],
        subject: 'Multi-recipient',
        text: 'Hello all',
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        'To:      user1@example.com, user2@example.com',
      );
    });

    it('should log from address when provided', async () => {
      await provider.send({
        to: 'test@example.com',
        subject: 'Test',
        text: 'Body',
        from: 'sender@example.com',
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('From:    sender@example.com');
    });

    it('should log reply-to when provided', async () => {
      await provider.send({
        to: 'test@example.com',
        subject: 'Test',
        text: 'Body',
        replyTo: 'reply@example.com',
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('Reply-To: reply@example.com');
    });

    it('should use text content when html not provided', async () => {
      await provider.send({
        to: 'test@example.com',
        subject: 'Test',
        text: 'Plain text content',
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('Plain text content');
    });

    it('should show "(no content)" when neither html nor text provided', async () => {
      await provider.send({
        to: 'test@example.com',
        subject: 'Test',
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('(no content)');
    });
  });

  describe('getName', () => {
    it('should return "console"', () => {
      expect(provider.getName()).toBe('console');
    });
  });
});
