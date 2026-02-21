import { Type, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as http from 'http';
import { loadEnvIfExists } from './create-app';
import { readPackageJson } from '../utils/package-json';

interface StartWorkerOptions {
  healthPort?: number;
}

/**
 * Bootstrap a worker process with standard configuration.
 *
 * Handles:
 * 1. loadEnvIfExists() - loads root .env for SECRETS_PROVIDER
 * 2. Sets SERVICE_NAME from package.json (required by SecretsModule)
 * 3. Creates application context with the worker module
 * 4. Health endpoint on configurable port (default :8080)
 * 5. Graceful shutdown with 9s timeout
 * 6. SIGTERM/SIGINT signal handlers
 *
 * @example
 * // apps/auth-service/src/worker.ts
 * import { startWorker } from '@tsdevstack/nest-common';
 * import { WorkerModule } from './worker.module';
 *
 * startWorker(WorkerModule);
 */
export async function startWorker<T>(
  WorkerModule: Type<T>,
  options?: StartWorkerOptions
): Promise<void> {
  const healthPort = options?.healthPort ?? 8080;
  const logger = new Logger('Worker');

  // 1. Load .env if it exists (local dev only)
  // Must happen BEFORE SecretsService instantiation since it needs SECRETS_PROVIDER
  loadEnvIfExists();

  // 2. Read service metadata from package.json and set SERVICE_NAME
  const packageJson = readPackageJson();
  const serviceName = packageJson.name;
  process.env.SERVICE_NAME = serviceName;

  logger.log(`Starting worker for ${serviceName}`);

  // 3. Create application context
  const app = await NestFactory.createApplicationContext(WorkerModule);

  // 4. Health endpoint for container orchestration
  const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200);
      res.end('OK');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  healthServer.listen(healthPort);

  logger.log(`Worker started, health on :${healthPort}`);

  // 5. Graceful shutdown with 9s timeout (container platforms typically allow 10s)
  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`${signal} received, shutting down...`);

    const timeout = setTimeout(() => {
      logger.error('Shutdown timeout, forcing exit');
      process.exit(1);
    }, 9000);

    try {
      healthServer.close();
      await app.close();
      clearTimeout(timeout);
      process.exit(0);
    } catch (err) {
      logger.error('Shutdown error', err);
      process.exit(1);
    }
  };

  // 6. Signal handlers
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}