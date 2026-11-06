import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { keepMessagesClaimed } from './keep-messages-claimed';

describe('keepMessagesClaimed', () => {
  let pipeline: Record<string, ReturnType<typeof rs.fn>>;
  let mockRedis: Record<string, ReturnType<typeof rs.fn>>;

  beforeEach(() => {
    pipeline = {
      xpending: rs.fn(),
      exec: rs.fn().mockResolvedValue([]),
    };
    pipeline.xpending.mockReturnValue(pipeline);
    mockRedis = {
      pipeline: rs.fn().mockReturnValue(pipeline),
      xclaim: rs.fn().mockResolvedValue([]),
    };
  });

  const run = (ids: string[]): Promise<void> =>
    keepMessagesClaimed(
      mockRedis as never,
      'app:messaging:topic',
      'app:messaging:topic:svc',
      'svc:host:1:abcd',
      ids,
    );

  describe('Standard use cases', () => {
    it('should reset the idle time of the messages this consumer owns, without counting a delivery', async () => {
      pipeline.exec.mockResolvedValue([
        [null, [['1-0', 'svc:host:1:abcd', 25_000, 1]]],
        [null, [['2-0', 'svc:host:1:abcd', 25_000, 1]]],
      ]);

      await run(['1-0', '2-0']);

      expect(pipeline.xpending).toHaveBeenCalledWith(
        'app:messaging:topic',
        'app:messaging:topic:svc',
        '1-0',
        '1-0',
        1,
        'svc:host:1:abcd',
      );
      expect(mockRedis.xclaim).toHaveBeenCalledWith(
        'app:messaging:topic',
        'app:messaging:topic:svc',
        'svc:host:1:abcd',
        0,
        '1-0',
        '2-0',
        'JUSTID',
      );
    });

    it('should leave a message another instance took over with that instance', async () => {
      pipeline.exec.mockResolvedValue([
        [null, [['1-0', 'svc:host:1:abcd', 25_000, 1]]],
        [null, []],
      ]);

      await run(['1-0', '2-0']);

      expect(mockRedis.xclaim).toHaveBeenCalledWith(
        'app:messaging:topic',
        'app:messaging:topic:svc',
        'svc:host:1:abcd',
        0,
        '1-0',
        'JUSTID',
      );
    });
  });

  describe('Edge cases', () => {
    it('should do nothing without messages', async () => {
      await run([]);

      expect(mockRedis.pipeline).not.toHaveBeenCalled();
      expect(mockRedis.xclaim).not.toHaveBeenCalled();
    });

    it('should not claim when this consumer owns none of them', async () => {
      pipeline.exec.mockResolvedValue([[null, []]]);

      await run(['1-0']);

      expect(mockRedis.xclaim).not.toHaveBeenCalled();
    });

    it('should skip a message whose ownership check failed', async () => {
      pipeline.exec.mockResolvedValue([
        [new Error('timeout'), null],
        [null, [['2-0', 'svc:host:1:abcd', 25_000, 1]]],
      ]);

      await run(['1-0', '2-0']);

      expect(mockRedis.xclaim).toHaveBeenCalledWith(
        'app:messaging:topic',
        'app:messaging:topic:svc',
        'svc:host:1:abcd',
        0,
        '2-0',
        'JUSTID',
      );
    });
  });
});
