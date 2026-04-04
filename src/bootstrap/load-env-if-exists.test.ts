import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

const { mockExistsSync, mockReadFileSync, mockDotenvConfig } = rs.hoisted(
  () => {
    return {
      mockExistsSync: rs.fn(),
      mockReadFileSync: rs.fn(),
      mockDotenvConfig: rs.fn(),
    };
  },
);

rs.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  default: { existsSync: mockExistsSync, readFileSync: mockReadFileSync },
}));

rs.mock('dotenv', () => ({
  default: { config: mockDotenvConfig },
}));

import { loadEnvIfExists } from './load-env-if-exists';

describe('loadEnvIfExists', () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd;

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = { ...originalEnv };
    process.cwd = rs.fn().mockReturnValue('/project/apps/service');
  });

  afterEach(() => {
    process.env = originalEnv;
    process.cwd = originalCwd;
  });

  it('should skip if SECRETS_PROVIDER already set', () => {
    process.env.SECRETS_PROVIDER = 'gcp';

    loadEnvIfExists();

    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('should load .env with SECRETS_PROVIDER marker', () => {
    delete process.env.SECRETS_PROVIDER;
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      'SECRETS_PROVIDER=local\nREDIS_HOST=localhost',
    );

    loadEnvIfExists();

    expect(mockDotenvConfig).toHaveBeenCalled();
  });

  it('should skip .env without SECRETS_PROVIDER marker', () => {
    delete process.env.SECRETS_PROVIDER;
    // First .env found but no marker, then no more files
    mockExistsSync.mockReturnValueOnce(true).mockReturnValue(false);
    mockReadFileSync.mockReturnValue('DATABASE_URL=postgres://...');

    loadEnvIfExists();

    expect(mockDotenvConfig).not.toHaveBeenCalled();
  });

  it('should silently return when .env not found', () => {
    delete process.env.SECRETS_PROVIDER;
    mockExistsSync.mockReturnValue(false);

    expect(() => loadEnvIfExists()).not.toThrow();
  });
});
