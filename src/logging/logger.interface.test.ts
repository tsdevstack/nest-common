import { describe, it, expect } from '@rstest/core';
import { Writable } from 'node:stream';
import pino from 'pino';
import { DEFAULT_REDACT_PATHS } from './logger.interface';

/**
 * Logs one entry through real pino with the default paths and returns the
 * written line
 */
function logWithDefaults(
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = pino(
    { redact: { paths: DEFAULT_REDACT_PATHS, censor: '[REDACTED]' } },
    destination,
  );
  logger.info(entry, 'message');
  return JSON.parse(lines[0]) as Record<string, unknown>;
}

describe('DEFAULT_REDACT_PATHS', () => {
  describe('Standard use cases', () => {
    it('should hide credentials at the top of the entry', () => {
      const line = logWithDefaults({
        password: 'p',
        newPassword: 'n',
        currentPassword: 'c',
        passwordHash: 'h',
        accessToken: 'a',
        refreshToken: 'r',
        privateKey: 'k',
        email: 'ada@example.com',
      });

      for (const key of [
        'password',
        'newPassword',
        'currentPassword',
        'passwordHash',
        'accessToken',
        'refreshToken',
        'privateKey',
        'email',
      ]) {
        expect(line[key]).toBe('[REDACTED]');
      }
    });

    it('should hide credentials one level down', () => {
      const line = logWithDefaults({
        dto: { email: 'ada@example.com', newPassword: 'n' },
        tokens: { accessToken: 'a', refreshToken: 'r' },
      });

      expect(line.dto).toEqual({
        email: '[REDACTED]',
        newPassword: '[REDACTED]',
      });
      expect(line.tokens).toEqual({
        accessToken: '[REDACTED]',
        refreshToken: '[REDACTED]',
      });
    });

    it('should hide the request headers that carry credentials', () => {
      const line = logWithDefaults({
        headers: {
          authorization: 'Bearer abc',
          cookie: 'session=abc',
          'set-cookie': ['session=abc'],
          'x-api-key': 'key',
          'x-kong-trust': 'trust',
          'x-tsdevstack-frontend-token': 'frontend',
          'user-agent': 'curl/8',
        },
      });

      expect(line.headers).toEqual({
        authorization: '[REDACTED]',
        cookie: '[REDACTED]',
        'set-cookie': '[REDACTED]',
        'x-api-key': '[REDACTED]',
        'x-kong-trust': '[REDACTED]',
        'x-tsdevstack-frontend-token': '[REDACTED]',
        'user-agent': 'curl/8',
      });
    });
  });

  describe('Edge cases', () => {
    it('should keep other fields as they are', () => {
      const line = logWithDefaults({ userId: 'u1', http: { method: 'GET' } });

      expect(line.userId).toBe('u1');
      expect(line.http).toEqual({ method: 'GET' });
    });

    it('should not look deeper than one level down', () => {
      // The documented limit: deeper fields need their own redactPaths
      const line = logWithDefaults({
        body: { user: { email: 'ada@example.com' } },
      });

      expect(line.body).toEqual({ user: { email: 'ada@example.com' } });
    });
  });
});
