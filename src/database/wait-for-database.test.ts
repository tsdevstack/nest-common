import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import { Logger } from '@nestjs/common';
import { waitForDatabase } from './wait-for-database';

describe('waitForDatabase', () => {
  let warn: ReturnType<typeof rs.spyOn>;
  let log: ReturnType<typeof rs.spyOn>;
  let error: ReturnType<typeof rs.spyOn>;

  beforeEach(() => {
    warn = rs.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    log = rs.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    error = rs.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rs.restoreAllMocks();
  });

  describe('Standard use cases', () => {
    it('should resolve at once when the database answers', async () => {
      const pool = { query: rs.fn().mockResolvedValue({ rows: [] }) };

      await waitForDatabase(pool as never);

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith('SELECT 1');
      expect(warn).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it('should retry until the database answers, logging each failure', async () => {
      const pool = {
        query: rs
          .fn()
          .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
          .mockRejectedValueOnce(
            new Error('timeout exceeded when trying to connect'),
          )
          .mockResolvedValueOnce({ rows: [] }),
      };

      await waitForDatabase(pool as never, { initialDelayMs: 5 });

      expect(pool.query).toHaveBeenCalledTimes(3);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('attempt 1): connect ECONNREFUSED'),
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('Database reachable after'),
      );
    });
  });

  describe('Edge cases', () => {
    it('should give up after the deadline with the last reason', async () => {
      const pool = {
        query: rs.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
      };

      await expect(
        waitForDatabase(pool as never, { timeoutMs: 60, initialDelayMs: 10 }),
      ).rejects.toThrow(
        /Database not reachable after \d+ s \(\d+ attempts\): connect ECONNREFUSED/,
      );
      expect(pool.query.mock.calls.length).toBeGreaterThan(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(/^Database not reachable after/),
      );
    });

    it('should not wait past the deadline for a query that hangs', async () => {
      const pool = { query: rs.fn(() => new Promise(() => {})) };
      const startedAt = Date.now();

      await expect(
        waitForDatabase(pool as never, { timeoutMs: 100, initialDelayMs: 10 }),
      ).rejects.toThrow(/Database not reachable/);
      expect(Date.now() - startedAt).toBeLessThan(1000);
    });

    it('should cap the retry delay at 5 s', async () => {
      const delays: number[] = [];
      const realSetTimeout = global.setTimeout;
      rs.spyOn(global, 'setTimeout').mockImplementation(((
        fn: () => void,
        ms?: number,
      ) => {
        if (typeof ms === 'number' && ms !== 60_000) {
          delays.push(ms);
        }
        return realSetTimeout(fn, 0);
      }) as typeof setTimeout);
      const pool = {
        query: rs
          .fn()
          .mockRejectedValueOnce(new Error('down'))
          .mockRejectedValueOnce(new Error('down'))
          .mockRejectedValueOnce(new Error('down'))
          .mockRejectedValueOnce(new Error('down'))
          .mockRejectedValueOnce(new Error('down'))
          .mockResolvedValueOnce({ rows: [] }),
      };

      await waitForDatabase(pool as never, { initialDelayMs: 2000 });

      const retryDelays = delays.filter((ms) => ms >= 2000 && ms <= 5000);
      expect(retryDelays).toEqual([2000, 4000, 5000, 5000, 5000]);
    });
  });
});
