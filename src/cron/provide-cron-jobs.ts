import type { Provider, Type } from '@nestjs/common';
import type { CronJobHandler } from './cron-job-handler.interface';
import { CRON_JOBS } from './cron.constants';

/**
 * The providers a CronModule lists: the handler classes themselves, and
 * the CRON_JOBS list runCronJob picks from by name.
 *
 * @example
 * const handlers = [UsageReportCron];
 * @Module({ imports: [...], providers: provideCronJobs(handlers) })
 * export class CronModule {}
 */
export function provideCronJobs(handlers: Type<CronJobHandler>[]): Provider[] {
  return [
    ...handlers,
    {
      provide: CRON_JOBS,
      useFactory: (...instances: CronJobHandler[]): CronJobHandler[] =>
        instances,
      inject: handlers,
    },
  ];
}
