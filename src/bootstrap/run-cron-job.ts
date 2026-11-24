import { randomUUID } from 'node:crypto';
import {
  Logger,
  type INestApplicationContext,
  type Type,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { loadEnvIfExists } from './load-env-if-exists';
import { LoggerService } from '../logging/logger.service';
import { NestLoggerAdapter } from '../logging/nest-logger-adapter';
import { readPackageJson } from '../utils/read-package-json';
import { RedisService } from '../redis/redis.service';
import type { CronJobHandler } from '../cron/cron-job-handler.interface';
import { buildCronLockKey } from '../cron/build-cron-lock-key';
import {
  CRON_EXIT_FAILURE,
  CRON_EXIT_SUCCESS,
  CRON_EXIT_UNKNOWN_JOB,
  CRON_FINISHED_MESSAGE,
  CRON_JOB_NAME_ENV,
  CRON_JOB_TIMEOUT_ENV,
  CRON_JOBS,
  CRON_LOCK_MARGIN_SECONDS,
  CRON_LOCK_RELEASE_TIMEOUT_MS,
  CRON_SIGTERM_GRACE_MS,
  DEFAULT_CRON_JOB_TIMEOUT_SECONDS,
  type CronJobOutcome,
} from '../cron/cron.constants';

/**
 * Run one cron job handler to completion and exit with its result.
 *
 * 1. loadEnvIfExists() - the root .env for SECRETS_PROVIDER (local runs)
 * 2. SERVICE_NAME from package.json, CRON_JOB_NAME from the argument
 * 3. The application context of the service's CronModule
 * 4. The handler whose `name` is the argument, from the CRON_JOBS list
 * 5. The overlap lock in Redis (`cron:{service}:{name}`, TTL = timeout + margin):
 *    a run that finds it held logs a warning and exits 0
 * 6. handler.run(signal), inside one span named after the job, so the
 *    handler's queries are one trace. The signal fires at the timeout (the
 *    runner's own timer, so it is the same on every cloud and locally; the
 *    platform's kill is a backstop), on SIGTERM or on SIGINT; the run then
 *    counts as stopped, and a handler that ignores the signal is exited
 *    after a grace
 * 7. The lock is released, the context closed (which flushes the traces),
 *    one `cron job finished` line is logged, the process exits:
 *    0 succeeded or skipped, 1 failed or stopped or no lock, 2 never started
 *
 * @example
 * // apps/auth-service/src/cron.ts
 * import { runCronJob } from '@tsdevstack/nest-common';
 * import { CronModule } from './cron.module';
 *
 * void runCronJob(CronModule, process.argv[2]);
 */
export async function runCronJob<T>(
  CronModule: Type<T>,
  name: string | undefined,
): Promise<void> {
  const started = Date.now();

  // Before the loggers: they read both at construction
  loadEnvIfExists();
  const serviceName = readPackageJson().name;
  process.env.SERVICE_NAME = serviceName;
  if (name) {
    process.env[CRON_JOB_NAME_ENV] = name;
  }

  // Nest's logger writes through LoggerService (JSON in the cloud, one line
  // locally), from the first message on. The job's name is on every line.
  const root = new LoggerService();
  const nestLogger = new NestLoggerAdapter(root);
  Logger.overrideLogger(nestLogger);
  const log = root.child('Cron');

  let app: INestApplicationContext | undefined;
  let finished = false;

  const logFinished = (outcome: CronJobOutcome, exitCode: number): void => {
    finished = true;
    log.info(CRON_FINISHED_MESSAGE, {
      outcome,
      exitCode,
      durationMs: Date.now() - started,
    });
  };

  const finish = async (
    outcome: CronJobOutcome,
    exitCode: number,
  ): Promise<void> => {
    logFinished(outcome, exitCode);
    if (app) {
      try {
        await app.close();
      } catch (error) {
        log.error('Shutdown error', error);
      }
    }
    process.exit(exitCode);
  };

  if (!name) {
    log.error('No cron job name given', undefined, {
      hint: 'node dist/cron.js <name>',
    });
    return finish('unknown', CRON_EXIT_UNKNOWN_JOB);
  }

  try {
    // abortOnError false: a module that fails to start throws here instead
    // of NestJS exiting the process, so the finished line is still written
    app = await NestFactory.createApplicationContext(CronModule, {
      logger: nestLogger,
      abortOnError: false,
    });
  } catch (error) {
    log.error(`Cron job "${name}": the module failed to start`, error);
    return finish('failed', CRON_EXIT_FAILURE);
  }

  let handlers: CronJobHandler[];
  try {
    handlers = app.get<CronJobHandler[]>(CRON_JOBS);
  } catch {
    log.error('CronModule provides no cron jobs', undefined, {
      hint: 'providers: provideCronJobs([...handlers])',
    });
    return finish('unknown', CRON_EXIT_UNKNOWN_JOB);
  }

  const known = handlers.map((handler) => handler.name);
  const matching = handlers.filter((handler) => handler.name === name);
  if (matching.length === 0) {
    log.error(`Unknown cron job "${name}"`, undefined, { known });
    return finish('unknown', CRON_EXIT_UNKNOWN_JOB);
  }
  if (matching.length > 1) {
    log.error(
      `${matching.length} cron job handlers are named "${name}"`,
      undefined,
      { known },
    );
    return finish('unknown', CRON_EXIT_UNKNOWN_JOB);
  }
  const handler = matching[0];

  let redis: RedisService;
  try {
    redis = app.get(RedisService, { strict: false });
  } catch {
    log.error(
      'CronModule must import RedisModule: the overlap lock lives there',
    );
    return finish('unknown', CRON_EXIT_UNKNOWN_JOB);
  }

  const timeoutRaw = process.env[CRON_JOB_TIMEOUT_ENV];
  const timeoutParsed = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : NaN;
  const timeoutSeconds =
    Number.isFinite(timeoutParsed) && timeoutParsed > 0
      ? timeoutParsed
      : DEFAULT_CRON_JOB_TIMEOUT_SECONDS;

  const lockKey = buildCronLockKey(serviceName, name);
  const runId = randomUUID();
  const locked = await redis.setIfAbsent(
    lockKey,
    runId,
    timeoutSeconds + CRON_LOCK_MARGIN_SECONDS,
  );
  if (locked === null) {
    log.error(`Cron job "${name}": could not take the lock, Redis unreachable`);
    return finish('failed', CRON_EXIT_FAILURE);
  }
  if (!locked) {
    log.warn(`Cron job "${name}" skipped, a run is active`, { lockKey });
    return finish('skipped', CRON_EXIT_SUCCESS);
  }

  // Stopping: the runner's own timer at the timeout, SIGTERM (the platform's
  // kill, a backstop on GCP and Azure) or SIGINT (Ctrl-C locally). The
  // handler gets the signal and a grace period, then the process exits.
  // Neither timer is unref'd: a handler stuck on a promise with no handles
  // must not let the process fall out of the event loop with exit code 0.
  const controller = new AbortController();
  let stopping = false;
  const stop = (reason: string): void => {
    if (stopping) return;
    stopping = true;
    log.warn(`${reason}, stopping cron job "${name}"`);
    controller.abort();
    // Also the backstop for a close that hangs after the finished line
    setTimeout(() => {
      void (async (): Promise<void> => {
        if (!finished) {
          log.error(`Cron job "${name}" did not stop in time, forcing exit`);
          // The run never reached its finally: release the lock, bounded so
          // a slow Redis can't hold up the exit
          await Promise.race([
            redis.deleteIfEquals(lockKey, runId),
            new Promise<void>((resolve) =>
              setTimeout(resolve, CRON_LOCK_RELEASE_TIMEOUT_MS),
            ),
          ]);
          logFinished('stopped', CRON_EXIT_FAILURE);
        }
        process.exit(CRON_EXIT_FAILURE);
      })();
    }, CRON_SIGTERM_GRACE_MS);
  };
  const onSigterm = (): void => stop('SIGTERM received');
  const onSigint = (): void => stop('SIGINT received');
  const timeoutTimer = setTimeout(
    () => stop(`Timeout of ${timeoutSeconds} s reached`),
    timeoutSeconds * 1000,
  );
  process.on('SIGTERM', onSigterm);
  process.on('SIGINT', onSigint);

  // One span per run: the handler's queries become its children
  const tracer = trace.getTracer(serviceName);
  let outcome: CronJobOutcome = 'succeeded';
  log.info(`Cron job "${name}" started`, { timeoutSeconds });
  try {
    await tracer.startActiveSpan(
      `cron ${name}`,
      {
        attributes: {
          'cron.job': name,
          'cron.timeout_seconds': timeoutSeconds,
        },
      },
      async (span) => {
        try {
          await handler.run(controller.signal);
          if (stopping) {
            outcome = 'stopped';
          }
        } catch (error) {
          outcome = stopping ? 'stopped' : 'failed';
          span.recordException(
            error instanceof Error ? error : new Error(String(error)),
          );
          log.error(
            stopping
              ? `Cron job "${name}" stopped`
              : `Cron job "${name}" failed`,
            error,
          );
        } finally {
          span.setAttribute('cron.outcome', outcome);
          if (outcome !== 'succeeded') {
            span.setStatus({ code: SpanStatusCode.ERROR, message: outcome });
          }
          span.end();
        }
      },
    );
  } finally {
    clearTimeout(timeoutTimer);
    process.off('SIGTERM', onSigterm);
    process.off('SIGINT', onSigint);
    await redis.deleteIfEquals(lockKey, runId);
  }

  return finish(
    outcome,
    outcome === 'succeeded' ? CRON_EXIT_SUCCESS : CRON_EXIT_FAILURE,
  );
}
