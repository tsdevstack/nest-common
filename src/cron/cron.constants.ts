/**
 * Cron jobs: a service's run-to-completion handlers, started by the cloud
 * scheduler, or by `run-cron` locally, as `node dist/cron.js <name>`
 */

/** Injection token of the handler list a CronModule provides (provideCronJobs) */
export const CRON_JOBS = 'TSDEVSTACK_CRON_JOBS';

/** Set by runCronJob to the running job's name; every log line carries it as `cronJob` */
export const CRON_JOB_NAME_ENV = 'CRON_JOB_NAME';

/** Set by the deploy to the job's timeout in seconds; sizes the overlap lock's TTL */
export const CRON_JOB_TIMEOUT_ENV = 'CRON_JOB_TIMEOUT';

/** Assumed when CRON_JOB_TIMEOUT is not set (local runs); the config default */
export const DEFAULT_CRON_JOB_TIMEOUT_SECONDS = 600;

/** The lock outlives the timeout by this much, so a killed run's lock still expires */
export const CRON_LOCK_MARGIN_SECONDS = 60;

/** Redis key prefix of the overlap lock: `cron:{service}:{name}` */
export const CRON_LOCK_KEY_PREFIX = 'cron';

/**
 * After SIGTERM, how long a handler gets to stop before the process exits
 * anyway (ms). The platforms kill 10 s after the signal (Cloud Run).
 */
export const CRON_SIGTERM_GRACE_MS = 8000;

/** A forced exit waits at most this long for the lock release, so a slow Redis can't hold up the exit (ms) */
export const CRON_LOCK_RELEASE_TIMEOUT_MS = 1000;

/** The handler returned, or the run was skipped because one is active */
export const CRON_EXIT_SUCCESS = 0;

/** The handler threw, was stopped at the timeout, or the lock couldn't be taken */
export const CRON_EXIT_FAILURE = 1;

/** The job never started: no name, an unknown name, or a wiring error */
export const CRON_EXIT_UNKNOWN_JOB = 2;

/**
 * The last log line of every run, with `outcome`, `exitCode` and
 * `durationMs`. cli-infra reads it for a run's result where the platform
 * keeps none (the same string lives in infra-core's constants).
 */
export const CRON_FINISHED_MESSAGE = 'cron job finished';

/** How a run ended, in the finished line */
export type CronJobOutcome =
  'succeeded' | 'failed' | 'stopped' | 'skipped' | 'unknown';
