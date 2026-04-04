import type { Type } from '@nestjs/common';
import type { SwaggerConfig } from '../open-api-docs/create-swagger-document';
import { createApp } from './create-app';
import { loadEnvIfExists } from './load-env-if-exists';
import { loadFrameworkConfig } from '../config/load-framework-config';
import { readPackageJson } from '../utils/read-package-json';
import { titleCase } from '../utils/title-case';

import type { AppBootstrapOptions } from './create-app';

// Optional overrides for startApp
interface StartAppOptions {
  swagger?: SwaggerConfig;
  jsonLimit?: number;
  urlLimit?: number;
  enableShutdownHooks?: boolean;
}

export async function startApp<T>(
  AppModule: Type<T>,
  options?: StartAppOptions,
): Promise<void> {
  // 0. Load .env if it exists (local dev only)
  // Must happen BEFORE SecretsService instantiation since it needs SECRETS_PROVIDER
  loadEnvIfExists();

  // 1. Read service metadata from package.json
  const packageJson = readPackageJson();
  const serviceName = packageJson.name;

  // Set SERVICE_NAME for SecretsModule factory
  process.env.SERVICE_NAME = serviceName;

  // 2. Load framework configuration
  const frameworkConfig = loadFrameworkConfig(serviceName);
  console.log(`📋 Loaded framework config for ${serviceName}`);

  // 3. Auto-generate swagger config from package.json if not provided
  const swagger = options?.swagger || {
    title: titleCase(serviceName),
    description: packageJson.description || '',
    version: packageJson.version || '1.0.0',
  };

  // 5. Merge framework config with optional overrides
  // Use PORT env var (set by Cloud Run to 8080) or fall back to config port for local dev
  const port = process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : frameworkConfig.port;
  const appConfig: AppBootstrapOptions = {
    port,
    globalPrefix: frameworkConfig.globalPrefix,
    swagger,
    jsonLimit: options?.jsonLimit,
    urlLimit: options?.urlLimit,
    enableShutdownHooks: options?.enableShutdownHooks,
  };

  // 6. Create and start the app
  const app = await createApp(AppModule, appConfig);
  // Bind to 0.0.0.0 for Cloud Run (default localhost blocks external connections)
  await app.listen(appConfig.port, '0.0.0.0');
}
