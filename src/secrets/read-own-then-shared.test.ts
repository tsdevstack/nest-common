import { describe, it, expect, rs } from '@rstest/core';
import { readOwnThenShared } from './read-own-then-shared';

const store =
  (scopes: Record<string, string | null | Error>) =>
  async (scope: string): Promise<string | null> => {
    const entry = scopes[scope] ?? null;
    if (entry instanceof Error) {
      throw entry;
    }
    return entry;
  };

describe('readOwnThenShared', () => {
  describe('Standard use cases', () => {
    it("should return the service's own value when both scopes have the key", async () => {
      const read = store({ 'auth-service': 'own', shared: 'shared' });

      await expect(readOwnThenShared(read, 'auth-service')).resolves.toBe(
        'own',
      );
    });

    it('should return the shared value when the service has none', async () => {
      const read = store({ shared: 'shared' });

      await expect(readOwnThenShared(read, 'auth-service')).resolves.toBe(
        'shared',
      );
    });

    it('should return null when neither scope has the key', async () => {
      await expect(readOwnThenShared(store({}), 'auth-service')).resolves.toBe(
        null,
      );
    });

    it('should read both scopes at once', async () => {
      const read = rs.fn().mockResolvedValue(null);

      await readOwnThenShared(read, 'auth-service');

      expect(read).toHaveBeenCalledTimes(2);
      expect(read).toHaveBeenCalledWith('auth-service');
      expect(read).toHaveBeenCalledWith('shared');
    });
  });

  describe('Edge cases', () => {
    it('should keep an empty own value instead of falling back', async () => {
      const read = store({ 'auth-service': '', shared: 'shared' });

      await expect(readOwnThenShared(read, 'auth-service')).resolves.toBe('');
    });

    it("should fail when the service's own read fails, even if shared has the key", async () => {
      const read = store({
        'auth-service': new Error('access denied'),
        shared: 'shared',
      });

      await expect(readOwnThenShared(read, 'auth-service')).rejects.toThrow(
        'access denied',
      );
    });

    it('should fail when the shared read fails and the service has no value', async () => {
      const read = store({ shared: new Error('network') });

      await expect(readOwnThenShared(read, 'auth-service')).rejects.toThrow(
        'network',
      );
    });

    it("should return the service's own value when only the shared read fails", async () => {
      const read = store({
        'auth-service': 'own',
        shared: new Error('network'),
      });

      await expect(readOwnThenShared(read, 'auth-service')).resolves.toBe(
        'own',
      );
    });
  });
});
