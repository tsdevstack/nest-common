import { describe, it, expect } from '@rstest/core';
import type { FactoryProvider } from '@nestjs/common';
import { provideCronJobs } from './provide-cron-jobs';
import { CRON_JOBS } from './cron.constants';
import type { CronJobHandler } from './cron-job-handler.interface';

class ReportCron implements CronJobHandler {
  readonly name = 'report';
  async run(): Promise<void> {}
}

class CleanupCron implements CronJobHandler {
  readonly name = 'cleanup';
  async run(): Promise<void> {}
}

type CronJobsProvider = FactoryProvider<CronJobHandler[]>;

describe('provideCronJobs', () => {
  describe('Standard use cases', () => {
    it('should list the handler classes as providers', () => {
      const providers = provideCronJobs([ReportCron, CleanupCron]);
      expect(providers).toContain(ReportCron);
      expect(providers).toContain(CleanupCron);
    });

    it('should provide the CRON_JOBS list built from the handler instances', () => {
      const providers = provideCronJobs([ReportCron, CleanupCron]);
      const list = providers.find(
        (p): p is CronJobsProvider =>
          typeof p === 'object' && 'provide' in p && p.provide === CRON_JOBS,
      );
      expect(list).toBeDefined();
      expect(list?.inject).toEqual([ReportCron, CleanupCron]);

      const report = new ReportCron();
      const cleanup = new CleanupCron();
      expect(list?.useFactory(report, cleanup)).toEqual([report, cleanup]);
    });
  });

  describe('Edge cases', () => {
    it('should provide an empty list for no handlers', () => {
      const providers = provideCronJobs([]);
      expect(providers).toHaveLength(1);
      const list = providers[0] as CronJobsProvider;
      expect(list.provide).toBe(CRON_JOBS);
      expect(list.useFactory()).toEqual([]);
    });
  });
});
