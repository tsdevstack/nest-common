/**
 * Wait For Database
 *
 * Startup gate: resolves once the database answers `SELECT 1`, retrying with
 * backoff until a deadline. Called from PrismaService.onModuleInit, so the
 * app only starts listening, and so only passes its platform's startup check
 * (Cloud Run startup probe, ECS health check, Container Apps startup probe),
 * once its database works. When the deadline passes it throws: startup
 * fails with the reason in the logs and the platform restarts the instance.
 *
 * Only startup waits: `/health` does not check the database, so a database
 * outage later never makes the platform restart instances.
 */

import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';

export interface WaitForDatabaseOptions {
  /** Total time to keep trying, in ms (default 60 s) */
  timeoutMs?: number;
  /** First retry delay, in ms; doubles up to 5 s (default 500 ms) */
  initialDelayMs?: number;
}

export async function waitForDatabase(
  pool: Pick<Pool, 'query'>,
  options: WaitForDatabaseOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxDelayMs = 5_000;
  const logger = new Logger('Database');
  const startedAt = Date.now();
  let delayMs = options.initialDelayMs ?? 500;
  let attempt = 0;

  for (;;) {
    attempt++;
    const remainingMs = Math.max(timeoutMs - (Date.now() - startedAt), 1);

    try {
      // The deadline also bounds a query that hangs (the pool's connect
      // timeout only covers opening the connection)
      const query = pool.query('SELECT 1');
      query.catch(() => undefined);
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        query,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`no answer within ${remainingMs} ms`)),
            remainingMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));

      if (attempt > 1) {
        logger.log(
          `Database reachable after ${Math.round((Date.now() - startedAt) / 1000)} s (attempt ${attempt})`,
        );
      }
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const elapsedMs = Date.now() - startedAt;

      if (elapsedMs + delayMs >= timeoutMs) {
        const message = `Database not reachable after ${Math.round(elapsedMs / 1000)} s (${attempt} attempts): ${reason}`;
        // Also in the structured logs: the thrown error surfaces as an
        // unhandled rejection, which Node prints as plain text
        logger.error(message);
        throw new Error(message, { cause: error });
      }

      logger.warn(
        `Database not reachable yet (attempt ${attempt}): ${reason}; retrying in ${delayMs} ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  }
}
