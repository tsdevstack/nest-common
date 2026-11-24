import { CRON_LOCK_KEY_PREFIX } from './cron.constants';

/**
 * The Redis key of a cron job's overlap lock: `cron:{service}:{name}`
 *
 * @param serviceName - The service the job belongs to (its package.json name)
 * @param jobName - The job's name
 */
export function buildCronLockKey(serviceName: string, jobName: string): string {
  return `${CRON_LOCK_KEY_PREFIX}:${serviceName}:${jobName}`;
}
