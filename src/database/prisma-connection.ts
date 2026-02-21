/**
 * Prisma Connection Manager
 *
 * Provides connection configuration for Prisma 7 with pg adapter.
 * Prisma 7's "client" engine requires an adapter - pg Pool is used in all environments.
 * Production uses DB_POOL_MAX for pool size, development defaults to 5 connections.
 */

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

export interface PrismaConnectionConfig {
  /** Prisma adapter (required for Prisma 7 client engine) */
  adapter: PrismaPg;
}

export interface PrismaConnectionResult {
  /** Config to pass to PrismaClient constructor */
  config: PrismaConnectionConfig;
  /** Pool instance - call pool.end() on shutdown */
  pool: Pool;
}

/**
 * Create Prisma connection configuration with pg adapter.
 *
 * Prisma 7 with "client" engine requires an adapter, so pg Pool is used
 * in all environments. Production requires DB_POOL_MAX, development
 * defaults to 5 connections.
 *
 * @returns Configuration object and pool reference for cleanup
 *
 * @example
 * ```typescript
 * import { createPrismaConnection } from '@tsdevstack/nest-common';
 * import { PrismaClient } from './generated/prisma';
 *
 * const { config, pool } = createPrismaConnection();
 *
 * class PrismaService extends PrismaClient {
 *   constructor() {
 *     super(config);
 *   }
 *
 *   async onModuleDestroy() {
 *     await this.$disconnect();
 *     await pool.end();
 *   }
 * }
 * ```
 */
export function createPrismaConnection(): PrismaConnectionResult {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !process.env.DB_POOL_MAX) {
    throw new Error('DB_POOL_MAX is required in production');
  }

  const poolMax = isProduction ? parseInt(process.env.DB_POOL_MAX!, 10) : 5; // Development default

  // AWS RDS requires SSL but uses Amazon's CA (self-signed from client perspective)
  // VPC network is already secured, so we skip certificate verification
  const sslConfig =
    process.env.CLOUD_PROVIDER === 'aws'
      ? { rejectUnauthorized: false }
      : undefined;

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: poolMax,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: sslConfig,
  });

  const adapter = new PrismaPg(pool);

  return {
    config: { adapter },
    pool,
  };
}
