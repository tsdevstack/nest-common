import { describe, it, expect, rs } from '@rstest/core';
import { hasConsumerGroups } from './has-consumer-groups';

describe('hasConsumerGroups', () => {
  describe('Standard use cases', () => {
    it('should be true when the stream has a group', async () => {
      const redis = { xinfo: rs.fn().mockResolvedValue([['name', 'g1']]) };

      await expect(hasConsumerGroups(redis as never, 's')).resolves.toBe(true);
      expect(redis.xinfo).toHaveBeenCalledWith('GROUPS', 's');
    });

    it('should be false when the stream has no group', async () => {
      const redis = { xinfo: rs.fn().mockResolvedValue([]) };

      await expect(hasConsumerGroups(redis as never, 's')).resolves.toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should be false when the stream does not exist yet', async () => {
      const redis = {
        xinfo: rs.fn().mockRejectedValue(new Error('ERR no such key')),
      };

      await expect(hasConsumerGroups(redis as never, 's')).resolves.toBe(false);
    });

    it('should pass on other Redis errors', async () => {
      const redis = {
        xinfo: rs.fn().mockRejectedValue(new Error('Connection reset')),
      };

      await expect(hasConsumerGroups(redis as never, 's')).rejects.toThrow(
        'Connection reset',
      );
    });
  });
});
