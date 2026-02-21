import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

const { mockPool, MockPool, MockPrismaPg } = rs.hoisted(() => {
  const pool = { on: rs.fn() };
  return {
    mockPool: pool,
    MockPool: rs.fn().mockImplementation(() => pool),
    MockPrismaPg: rs.fn().mockImplementation(() => ({ __adapter: true })),
  };
});

rs.mock('pg', () => ({
  Pool: MockPool,
}));

rs.mock('@prisma/adapter-pg', () => ({
  PrismaPg: MockPrismaPg,
}));

import { createPrismaConnection } from './prisma-connection';

describe('createPrismaConnection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Development mode', () => {
    it('should use default pool size of 5', () => {
      process.env.NODE_ENV = 'development';

      createPrismaConnection();

      expect(MockPool).toHaveBeenCalledWith(
        expect.objectContaining({ max: 5 }),
      );
    });

    it('should not require DB_POOL_MAX', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DB_POOL_MAX;

      expect(() => createPrismaConnection()).not.toThrow();
    });
  });

  describe('Production mode', () => {
    it('should throw if DB_POOL_MAX is not set', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DB_POOL_MAX;

      expect(() => createPrismaConnection()).toThrow(
        'DB_POOL_MAX is required in production',
      );
    });

    it('should use DB_POOL_MAX for pool size', () => {
      process.env.NODE_ENV = 'production';
      process.env.DB_POOL_MAX = '20';

      createPrismaConnection();

      expect(MockPool).toHaveBeenCalledWith(
        expect.objectContaining({ max: 20 }),
      );
    });
  });

  describe('SSL configuration', () => {
    it('should apply SSL config for AWS provider', () => {
      process.env.CLOUD_PROVIDER = 'aws';

      createPrismaConnection();

      expect(MockPool).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { rejectUnauthorized: false },
        }),
      );
    });

    it('should not apply SSL config for GCP provider', () => {
      process.env.CLOUD_PROVIDER = 'gcp';

      createPrismaConnection();

      expect(MockPool).toHaveBeenCalledWith(
        expect.objectContaining({ ssl: undefined }),
      );
    });

    it('should not apply SSL config when no provider set', () => {
      delete process.env.CLOUD_PROVIDER;

      createPrismaConnection();

      expect(MockPool).toHaveBeenCalledWith(
        expect.objectContaining({ ssl: undefined }),
      );
    });
  });

  describe('Pool configuration', () => {
    it('should pass DATABASE_URL as connectionString', () => {
      process.env.DATABASE_URL = 'postgresql://db:5432/mydb';

      createPrismaConnection();

      expect(MockPool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'postgresql://db:5432/mydb',
        }),
      );
    });

    it('should set idle timeout to 30 seconds', () => {
      createPrismaConnection();

      expect(MockPool).toHaveBeenCalledWith(
        expect.objectContaining({ idleTimeoutMillis: 30000 }),
      );
    });

    it('should set connection timeout to 10 seconds', () => {
      createPrismaConnection();

      expect(MockPool).toHaveBeenCalledWith(
        expect.objectContaining({ connectionTimeoutMillis: 10000 }),
      );
    });
  });

  describe('Return value', () => {
    it('should return config with adapter and pool', () => {
      const result = createPrismaConnection();

      expect(result.config).toBeDefined();
      expect(result.config.adapter).toBeDefined();
      expect(result.pool).toBeDefined();
    });

    it('should create PrismaPg adapter from pool', () => {
      createPrismaConnection();

      expect(MockPrismaPg).toHaveBeenCalledWith(mockPool);
    });
  });
});
