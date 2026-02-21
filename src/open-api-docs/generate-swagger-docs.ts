import { Type, VersioningType } from '@nestjs/common';
import { createSwaggerDocument } from './create-swagger-document';
import { OpenAPIObject } from '@nestjs/swagger';
import { NestFactory } from '@nestjs/core';
// import { SecretsService } from '../secrets/secrets.service';
import { readPackageJson, titleCase } from '../utils/package-json';
import { loadFrameworkConfig } from '../config/load-framework-config';
import { loadEnvIfExists } from '../bootstrap/create-app';

/**
 * Generate Swagger/OpenAPI documentation
 *
 * Reads service metadata from package.json automatically.
 * No validation is performed - validation happens at dev/build time via CLI.
 *
 * @param AppModule - The NestJS application module
 * @returns OpenAPI document object
 */
export async function generateSwaggerDocs<T>(
  AppModule: Type<T>,
): Promise<OpenAPIObject> {
  // Load .env if it exists (local dev only) - loads SECRETS_PROVIDER
  // Must happen BEFORE SecretsService instantiation
  loadEnvIfExists();

  // Read service metadata from package.json
  const packageJson = readPackageJson();
  const serviceName = packageJson.name;

  // Set SERVICE_NAME for SecretsModule factory
  process.env.SERVICE_NAME = serviceName;

  // Load framework config to get globalPrefix
  const frameworkConfig = loadFrameworkConfig(serviceName);

  // Create app without starting HTTP server
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
    preview: true,
    abortOnError: false,
  });

  // Set global prefix (no validation - CLI validates at dev/build time)
  app.setGlobalPrefix(frameworkConfig.globalPrefix);

  // Enable versioning (needed for proper route resolution)
  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'v',
  });

  // Auto-generate swagger config from package.json
  const swaggerConfig = {
    title: titleCase(serviceName),
    description: packageJson.description || '',
    version: packageJson.version || '1.0.0',
    globalPrefix: frameworkConfig.globalPrefix,
  };

  const document = createSwaggerDocument(app, swaggerConfig);

  // Clean up
  await app.close();

  return document;
}
