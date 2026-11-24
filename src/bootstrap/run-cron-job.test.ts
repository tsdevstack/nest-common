import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

const {
  mockCreateApplicationContext,
  mockApp,
  mockLoadEnvIfExists,
  mockReadPackageJson,
  mockOverrideLogger,
  mockLog,
  mockRedis,
  mockSpan,
  mockStartActiveSpan,
  mockGetTracer,
  state,
} = rs.hoisted(() => {
  const log = {
    info: rs.fn(),
    warn: rs.fn(),
    error: rs.fn(),
    debug: rs.fn(),
  };
  const redis = {
    setIfAbsent: rs.fn(),
    deleteIfEquals: rs.fn(),
  };
  const span = {
    end: rs.fn(),
    setAttribute: rs.fn(),
    setStatus: rs.fn(),
    recordException: rs.fn(),
  };
  const startActiveSpan = rs.fn(
    (
      _name: string,
      _options: unknown,
      callback: (activeSpan: typeof span) => Promise<void>,
    ) => callback(span),
  );
  const state = {
    handlers: [] as Array<{ name: string; run: unknown }>,
    cronJobsProvided: true,
    redisProvided: true,
  };
  const app = {
    close: rs.fn(),
    get: rs.fn((token: unknown) => {
      if (token === 'TSDEVSTACK_CRON_JOBS') {
        if (!state.cronJobsProvided) throw new Error('no provider');
        return state.handlers;
      }
      if (!state.redisProvided) throw new Error('no provider');
      return redis;
    }),
  };
  return {
    mockCreateApplicationContext: rs.fn(),
    mockApp: app,
    mockLoadEnvIfExists: rs.fn(),
    mockReadPackageJson: rs.fn(),
    mockOverrideLogger: rs.fn(),
    mockLog: log,
    mockRedis: redis,
    mockSpan: span,
    mockStartActiveSpan: startActiveSpan,
    mockGetTracer: rs.fn(() => ({ startActiveSpan })),
    state,
  };
});

rs.mock('@opentelemetry/api', () => ({
  trace: { getTracer: mockGetTracer },
  SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
}));

rs.mock('@nestjs/common', () => ({
  Logger: class {
    static overrideLogger = mockOverrideLogger;
  },
}));

rs.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: mockCreateApplicationContext,
  },
}));

rs.mock('../logging/logger.service', () => ({
  LoggerService: class {
    child(): unknown {
      return mockLog;
    }
  },
}));

rs.mock('../logging/nest-logger-adapter', () => ({
  NestLoggerAdapter: class {
    readonly isNestLoggerAdapter = true;
  },
}));

rs.mock('../redis/redis.service', () => ({
  RedisService: class {},
}));

rs.mock('./load-env-if-exists', () => ({
  loadEnvIfExists: mockLoadEnvIfExists,
}));

rs.mock('../utils/read-package-json', () => ({
  readPackageJson: mockReadPackageJson,
}));

import { runCronJob } from './run-cron-job';

/** The fields of the one `cron job finished` line */
function finishedLine(): Record<string, unknown> {
  const calls = mockLog.info.mock.calls as Array<[string, unknown]>;
  const lines = calls.filter(([message]) => message === 'cron job finished');
  expect(lines).toHaveLength(1);
  return lines[0][1] as Record<string, unknown>;
}

function exitCode(): number | undefined {
  const calls = rs.mocked(process.exit).mock.calls as Array<[number]>;
  return calls[calls.length - 1]?.[0];
}

type Signals = 'SIGTERM' | 'SIGINT';

/** Removes the signal listeners a run that never finished left behind */
function removeListenersAddedSince(
  before: Record<Signals, NodeJS.SignalsListener[]>,
): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as Signals[]) {
    for (const listener of process.listeners(signal)) {
      if (!before[signal].includes(listener)) {
        process.off(signal, listener);
      }
    }
  }
}

describe('runCronJob', () => {
  const originalEnv = process.env;
  const CronModule = class {};
  let report: { name: string; run: ReturnType<typeof rs.fn> };

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.CRON_JOB_NAME;
    delete process.env.CRON_JOB_TIMEOUT;
    rs.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    mockReadPackageJson.mockReturnValue({ name: 'auth-service' });
    mockCreateApplicationContext.mockResolvedValue(mockApp);
    mockApp.close.mockResolvedValue(undefined);
    mockRedis.setIfAbsent.mockResolvedValue(true);
    mockRedis.deleteIfEquals.mockResolvedValue(true);

    report = { name: 'report', run: rs.fn().mockResolvedValue(undefined) };
    state.handlers = [report];
    state.cronJobsProvided = true;
    state.redisProvided = true;
  });

  afterEach(() => {
    process.env = originalEnv;
    rs.restoreAllMocks();
  });

  describe('Startup', () => {
    it('should load env, set SERVICE_NAME and CRON_JOB_NAME, and route Nest logs through the adapter', async () => {
      await runCronJob(CronModule, 'report');

      expect(mockLoadEnvIfExists).toHaveBeenCalled();
      expect(process.env.SERVICE_NAME).toBe('auth-service');
      expect(process.env.CRON_JOB_NAME).toBe('report');
      const [adapter] = mockOverrideLogger.mock.calls[0] as [unknown];
      expect(adapter).toMatchObject({ isNestLoggerAdapter: true });
      expect(mockCreateApplicationContext).toHaveBeenCalledWith(CronModule, {
        logger: adapter,
        abortOnError: false,
      });
    });

    it('should exit 2 without starting the module when no name is given', async () => {
      await runCronJob(CronModule, undefined);

      expect(mockCreateApplicationContext).not.toHaveBeenCalled();
      expect(process.env.CRON_JOB_NAME).toBeUndefined();
      expect(mockLog.error).toHaveBeenCalledWith(
        'No cron job name given',
        undefined,
        { hint: 'node dist/cron.js <name>' },
      );
      expect(finishedLine()).toEqual({
        outcome: 'unknown',
        exitCode: 2,
        durationMs: expect.any(Number),
      });
      expect(exitCode()).toBe(2);
    });

    it('should exit 1 when the module fails to start', async () => {
      mockCreateApplicationContext.mockRejectedValue(new Error('no database'));

      await runCronJob(CronModule, 'report');

      // NestJS would exit the process itself on a start failure otherwise
      expect(mockCreateApplicationContext).toHaveBeenCalledWith(
        CronModule,
        expect.objectContaining({ abortOnError: false }),
      );
      expect(mockLog.error).toHaveBeenCalledWith(
        'Cron job "report": the module failed to start',
        expect.any(Error),
      );
      expect(finishedLine()).toMatchObject({ outcome: 'failed', exitCode: 1 });
      expect(exitCode()).toBe(1);
    });
  });

  describe('Picking the handler', () => {
    it('should exit 2 and list the known names for an unknown job', async () => {
      state.handlers = [report, { name: 'cleanup', run: rs.fn() }];

      await runCronJob(CronModule, 'nope');

      expect(mockLog.error).toHaveBeenCalledWith(
        'Unknown cron job "nope"',
        undefined,
        { known: ['report', 'cleanup'] },
      );
      expect(report.run).not.toHaveBeenCalled();
      expect(mockApp.close).toHaveBeenCalled();
      expect(exitCode()).toBe(2);
    });

    it('should exit 2 when two handlers share the name', async () => {
      state.handlers = [report, { name: 'report', run: rs.fn() }];

      await runCronJob(CronModule, 'report');

      expect(mockLog.error).toHaveBeenCalledWith(
        '2 cron job handlers are named "report"',
        undefined,
        { known: ['report', 'report'] },
      );
      expect(report.run).not.toHaveBeenCalled();
      expect(exitCode()).toBe(2);
    });

    it('should exit 2 with a hint when the module provides no cron jobs', async () => {
      state.cronJobsProvided = false;

      await runCronJob(CronModule, 'report');

      expect(mockLog.error).toHaveBeenCalledWith(
        'CronModule provides no cron jobs',
        undefined,
        { hint: 'providers: provideCronJobs([...handlers])' },
      );
      expect(exitCode()).toBe(2);
    });

    it('should exit 2 when RedisModule is not imported', async () => {
      state.redisProvided = false;

      await runCronJob(CronModule, 'report');

      expect(mockLog.error).toHaveBeenCalledWith(
        'CronModule must import RedisModule: the overlap lock lives there',
      );
      expect(report.run).not.toHaveBeenCalled();
      expect(exitCode()).toBe(2);
    });
  });

  describe('The lock', () => {
    it('should take cron:{service}:{name} with the default timeout plus the margin', async () => {
      await runCronJob(CronModule, 'report');

      expect(mockRedis.setIfAbsent).toHaveBeenCalledWith(
        'cron:auth-service:report',
        expect.any(String),
        660,
      );
    });

    it('should size the TTL from CRON_JOB_TIMEOUT', async () => {
      process.env.CRON_JOB_TIMEOUT = '1800';

      await runCronJob(CronModule, 'report');

      expect(mockRedis.setIfAbsent).toHaveBeenCalledWith(
        'cron:auth-service:report',
        expect.any(String),
        1860,
      );
    });

    it('should fall back to the default for an unusable CRON_JOB_TIMEOUT', async () => {
      process.env.CRON_JOB_TIMEOUT = 'soon';

      await runCronJob(CronModule, 'report');

      expect(mockRedis.setIfAbsent).toHaveBeenCalledWith(
        'cron:auth-service:report',
        expect.any(String),
        660,
      );
    });

    it('should release its own lock after the run', async () => {
      await runCronJob(CronModule, 'report');

      const [, runId] = mockRedis.setIfAbsent.mock.calls[0] as [string, string];
      expect(mockRedis.deleteIfEquals).toHaveBeenCalledWith(
        'cron:auth-service:report',
        runId,
      );
    });

    it('should skip with a warning and exit 0 when a run is active', async () => {
      mockRedis.setIfAbsent.mockResolvedValue(false);

      await runCronJob(CronModule, 'report');

      expect(mockLog.warn).toHaveBeenCalledWith(
        'Cron job "report" skipped, a run is active',
        { lockKey: 'cron:auth-service:report' },
      );
      expect(report.run).not.toHaveBeenCalled();
      expect(mockRedis.deleteIfEquals).not.toHaveBeenCalled();
      expect(finishedLine()).toMatchObject({
        outcome: 'skipped',
        exitCode: 0,
      });
      expect(exitCode()).toBe(0);
    });

    it('should exit 1 without running when Redis is unreachable', async () => {
      mockRedis.setIfAbsent.mockResolvedValue(null);

      await runCronJob(CronModule, 'report');

      expect(mockLog.error).toHaveBeenCalledWith(
        'Cron job "report": could not take the lock, Redis unreachable',
      );
      expect(report.run).not.toHaveBeenCalled();
      expect(exitCode()).toBe(1);
    });
  });

  describe('The run', () => {
    it('should run the handler with an abort signal and exit 0', async () => {
      await runCronJob(CronModule, 'report');

      expect(report.run).toHaveBeenCalledTimes(1);
      const [signal] = report.run.mock.calls[0] as [AbortSignal];
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
      expect(mockLog.info).toHaveBeenCalledWith('Cron job "report" started', {
        timeoutSeconds: 600,
      });
      expect(finishedLine()).toEqual({
        outcome: 'succeeded',
        exitCode: 0,
        durationMs: expect.any(Number),
      });
      expect(mockApp.close).toHaveBeenCalled();
      expect(exitCode()).toBe(0);
    });

    it('should log the error, release the lock and exit 1 when the handler throws', async () => {
      const failure = new Error('query failed');
      report.run.mockRejectedValue(failure);

      await runCronJob(CronModule, 'report');

      expect(mockLog.error).toHaveBeenCalledWith(
        'Cron job "report" failed',
        failure,
      );
      expect(mockRedis.deleteIfEquals).toHaveBeenCalled();
      expect(finishedLine()).toMatchObject({ outcome: 'failed', exitCode: 1 });
      expect(exitCode()).toBe(1);
    });

    it('should still exit when closing the context fails', async () => {
      mockApp.close.mockRejectedValue(new Error('close failed'));

      await runCronJob(CronModule, 'report');

      expect(mockLog.error).toHaveBeenCalledWith(
        'Shutdown error',
        expect.any(Error),
      );
      expect(exitCode()).toBe(0);
    });
  });

  describe('The span', () => {
    it("should run the handler inside one span named after the job, on the service's tracer", async () => {
      await runCronJob(CronModule, 'report');

      expect(mockGetTracer).toHaveBeenCalledWith('auth-service');
      expect(mockStartActiveSpan).toHaveBeenCalledWith(
        'cron report',
        {
          attributes: { 'cron.job': 'report', 'cron.timeout_seconds': 600 },
        },
        expect.any(Function),
      );
      const runOrder = report.run.mock.invocationCallOrder[0];
      expect(mockStartActiveSpan.mock.invocationCallOrder[0]).toBeLessThan(
        runOrder,
      );
      expect(mockSpan.end.mock.invocationCallOrder[0]).toBeGreaterThan(
        runOrder,
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'cron.outcome',
        'succeeded',
      );
      expect(mockSpan.setStatus).not.toHaveBeenCalled();
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('should record the error and mark the span failed when the handler throws', async () => {
      const failure = new Error('query failed');
      report.run.mockRejectedValue(failure);

      await runCronJob(CronModule, 'report');

      expect(mockSpan.recordException).toHaveBeenCalledWith(failure);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: 2,
        message: 'failed',
      });
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'cron.outcome',
        'failed',
      );
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('should wrap a thrown non-Error in an Error for the span', async () => {
      report.run.mockRejectedValue('oops');

      await runCronJob(CronModule, 'report');

      expect(mockSpan.recordException).toHaveBeenCalledWith(expect.any(Error));
      expect(
        (mockSpan.recordException.mock.calls[0] as [Error])[0].message,
      ).toBe('oops');
    });
  });

  describe('Stopping', () => {
    let listenersBefore: Record<Signals, NodeJS.SignalsListener[]>;

    /** The handler's start, and what its run does with the signal */
    function handlerThat(
      onSignal: (
        signal: AbortSignal,
        settle: {
          resolve: () => void;
          reject: (error: Error) => void;
        },
      ) => void,
    ): Promise<AbortSignal> {
      return new Promise<AbortSignal>((started) => {
        report.run.mockImplementation(
          (signal: AbortSignal) =>
            new Promise<void>((resolve, reject) => {
              onSignal(signal, { resolve, reject });
              started(signal);
            }),
        );
      });
    }

    beforeEach(() => {
      rs.useFakeTimers();
      listenersBefore = {
        SIGTERM: process.listeners('SIGTERM'),
        SIGINT: process.listeners('SIGINT'),
      };
    });

    afterEach(() => {
      removeListenersAddedSince(listenersBefore);
      rs.useRealTimers();
    });

    it('should abort the signal on SIGTERM, count the run as stopped and exit 1', async () => {
      const started = handlerThat((signal, { reject }) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );

      const running = runCronJob(CronModule, 'report');
      const signal = await started;
      process.emit('SIGTERM');
      await running;

      expect(signal.aborted).toBe(true);
      expect(mockLog.warn).toHaveBeenCalledWith(
        'SIGTERM received, stopping cron job "report"',
      );
      expect(mockLog.error).toHaveBeenCalledWith(
        'Cron job "report" stopped',
        expect.any(Error),
      );
      expect(mockRedis.deleteIfEquals).toHaveBeenCalled();
      expect(finishedLine()).toMatchObject({
        outcome: 'stopped',
        exitCode: 1,
      });
      expect(exitCode()).toBe(1);
      expect(process.listeners('SIGTERM')).toEqual(listenersBefore.SIGTERM);
      expect(process.listeners('SIGINT')).toEqual(listenersBefore.SIGINT);
    });

    it('should count a handler that returns after the signal as stopped', async () => {
      const started = handlerThat((signal, { resolve }) =>
        signal.addEventListener('abort', () => resolve()),
      );

      const running = runCronJob(CronModule, 'report');
      await started;
      process.emit('SIGINT');
      await running;

      expect(mockLog.warn).toHaveBeenCalledWith(
        'SIGINT received, stopping cron job "report"',
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: 2,
        message: 'stopped',
      });
      expect(finishedLine()).toMatchObject({
        outcome: 'stopped',
        exitCode: 1,
      });
      expect(exitCode()).toBe(1);
    });

    it('should stop the run itself at CRON_JOB_TIMEOUT, on every platform', async () => {
      process.env.CRON_JOB_TIMEOUT = '5';
      const started = handlerThat((signal, { reject }) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );

      const running = runCronJob(CronModule, 'report');
      const signal = await started;
      await rs.advanceTimersByTimeAsync(4_999);
      expect(signal.aborted).toBe(false);
      await rs.advanceTimersByTimeAsync(1);
      await running;

      expect(signal.aborted).toBe(true);
      expect(mockLog.warn).toHaveBeenCalledWith(
        'Timeout of 5 s reached, stopping cron job "report"',
      );
      expect(mockRedis.deleteIfEquals).toHaveBeenCalled();
      expect(finishedLine()).toMatchObject({
        outcome: 'stopped',
        exitCode: 1,
      });
      expect(exitCode()).toBe(1);
    });

    it('should not fire the timeout after a run that finished in time', async () => {
      process.env.CRON_JOB_TIMEOUT = '5';

      await runCronJob(CronModule, 'report');
      await rs.advanceTimersByTimeAsync(10_000);

      expect(mockLog.warn).not.toHaveBeenCalled();
      expect(finishedLine()).toMatchObject({ outcome: 'succeeded' });
    });

    it('should only exit, without a second finished line, when the close hangs after the finished line', async () => {
      const started = handlerThat((signal, { reject }) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );
      mockApp.close.mockReturnValue(new Promise<void>(() => undefined));

      void runCronJob(CronModule, 'report');
      await started;
      process.emit('SIGTERM');
      await rs.advanceTimersByTimeAsync(0);
      expect(finishedLine()).toMatchObject({ outcome: 'stopped', exitCode: 1 });
      expect(process.exit).not.toHaveBeenCalled();

      await rs.advanceTimersByTimeAsync(8_000);

      expect(mockLog.error).not.toHaveBeenCalledWith(
        'Cron job "report" did not stop in time, forcing exit',
      );
      expect(finishedLine()).toMatchObject({ outcome: 'stopped', exitCode: 1 });
      expect(exitCode()).toBe(1);
    });

    it('should force the exit with a finished line when the handler ignores the signal', async () => {
      const started = handlerThat(() => {
        // never settles, never looks at the signal
      });

      void runCronJob(CronModule, 'report');
      await started;
      process.emit('SIGTERM');
      await rs.advanceTimersByTimeAsync(7_999);
      expect(process.exit).not.toHaveBeenCalled();
      await rs.advanceTimersByTimeAsync(1);

      expect(mockLog.error).toHaveBeenCalledWith(
        'Cron job "report" did not stop in time, forcing exit',
      );
      const [, runId] = mockRedis.setIfAbsent.mock.calls[0] as [string, string];
      expect(mockRedis.deleteIfEquals).toHaveBeenCalledWith(
        'cron:auth-service:report',
        runId,
      );
      expect(finishedLine()).toMatchObject({
        outcome: 'stopped',
        exitCode: 1,
      });
      expect(exitCode()).toBe(1);
    });

    it('should not let a slow Redis hold up the forced exit beyond a second', async () => {
      const started = handlerThat(() => {
        // never settles, never looks at the signal
      });
      mockRedis.deleteIfEquals.mockReturnValue(
        new Promise<boolean>(() => undefined),
      );

      void runCronJob(CronModule, 'report');
      await started;
      process.emit('SIGTERM');
      await rs.advanceTimersByTimeAsync(8_000);

      expect(mockRedis.deleteIfEquals).toHaveBeenCalledTimes(1);
      expect(process.exit).not.toHaveBeenCalled();

      await rs.advanceTimersByTimeAsync(999);
      expect(process.exit).not.toHaveBeenCalled();
      await rs.advanceTimersByTimeAsync(1);

      expect(finishedLine()).toMatchObject({
        outcome: 'stopped',
        exitCode: 1,
      });
      expect(exitCode()).toBe(1);
    });
  });
});
