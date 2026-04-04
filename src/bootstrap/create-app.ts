import type { INestApplication, Type } from '@nestjs/common';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import compression from 'compression';
import express from 'express';
import { SwaggerModule } from '@nestjs/swagger';
import {
  createSwaggerDocument,
  SwaggerConfig,
} from '../open-api-docs/create-swagger-document';

export interface AppBootstrapOptions {
  port: number | string;
  globalPrefix: string;
  jsonLimit?: number;
  urlLimit?: number;
  enableShutdownHooks?: boolean;
  swagger: SwaggerConfig;
}

export async function createApp<T>(
  AppModule: Type<T>,
  options: AppBootstrapOptions,
): Promise<INestApplication> {
  const {
    globalPrefix,
    jsonLimit = 1,
    urlLimit = 1,
    enableShutdownHooks = true,
    swagger,
  } = options;

  // No validation here - CLI validates at dev/build time
  const app = await NestFactory.create(AppModule);

  // Set global prefix BEFORE versioning
  // Exclude infrastructure endpoints from prefix - they're accessed directly by Prometheus/K8s
  app.setGlobalPrefix(globalPrefix, {
    exclude: ['health', 'health/ping', 'metrics'],
  });

  // Enable URL versioning (comes after global prefix)
  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'v',
  });

  // Security middleware
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false, // Disable if there are iframe issues
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
    }),
  );

  // Compression
  app.use(compression());

  // Limit
  app.use(express.json({ limit: `${jsonLimit}mb` }));
  app.use(express.urlencoded({ limit: `${urlLimit}mb`, extended: true }));

  // CORS handled by Kong Gateway - no app-level CORS needed

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true, // Strip unknown properties
      forbidNonWhitelisted: true, // Reject requests with unknown properties
      disableErrorMessages: process.env.NODE_ENV === 'production',
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  if (enableShutdownHooks) {
    app.enableShutdownHooks();
  }

  // Setup Swagger in development
  if (process.env.NODE_ENV !== 'production') {
    // Pass globalPrefix to swagger config for correct client generation
    const swaggerConfigWithPrefix = {
      ...swagger,
      globalPrefix,
    };
    const document = createSwaggerDocument(app, swaggerConfigWithPrefix);
    SwaggerModule.setup('api', app, document);
  }

  return app;
}
