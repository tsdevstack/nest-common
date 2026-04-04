import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

const { mockExistsSync, mockReadFileSync } = rs.hoisted(() => ({
  mockExistsSync: rs.fn(),
  mockReadFileSync: rs.fn(),
}));

rs.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  default: { existsSync: mockExistsSync, readFileSync: mockReadFileSync },
}));

import { readPackageJson } from './read-package-json';

describe('readPackageJson', () => {
  const originalCwd = process.cwd;

  beforeEach(() => {
    rs.clearAllMocks();
    process.cwd = rs.fn().mockReturnValue('/project/apps/auth-service');
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it('should read and parse package.json', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        name: 'auth-service',
        version: '1.0.0',
        description: 'Auth',
      }),
    );

    const result = readPackageJson();

    expect(result).toEqual({
      name: 'auth-service',
      version: '1.0.0',
      description: 'Auth',
    });
  });

  it('should throw if package.json not found', () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => readPackageJson()).toThrow('package.json not found');
  });

  it('should throw on invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not json');

    expect(() => readPackageJson()).toThrow('Failed to parse package.json');
  });
});
