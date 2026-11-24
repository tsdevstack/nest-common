/**
 * A cron job handler: one class per job, in the service's
 * `src/cron/{name}.cron.ts`, listed in its CronModule through
 * provideCronJobs. `register-cron` writes the file.
 */
export interface CronJobHandler {
  /** The job's name: the `name` of its entry in infrastructure.json */
  readonly name: string;

  /**
   * Does the work. Returning is success, throwing is failure. The signal
   * fires at the job's timeout or when the platform stops the run: fetch
   * accepts it as is; Prisma calls and loops check `signal.aborted`
   * between steps.
   */
  run(signal: AbortSignal): Promise<void>;
}
