import { describe, it, expect } from '@rstest/core';
import { isInfrastructurePath } from './is-infrastructure-path';

describe('isInfrastructurePath', () => {
  describe('Infrastructure paths', () => {
    it.each([
      '/auth/.well-known/jwks.json',
      '/auth/.well-known/openid-configuration',
      '/.well-known/jwks.json',
      '/health',
      '/health/ping',
      '/metrics',
    ])('should exempt %s', (path) => {
      expect(isInfrastructurePath(path)).toBe(true);
    });
  });

  describe('Other paths', () => {
    it.each([
      '/offers/v1/plans',
      '/healthcheck',
      '/metrics/extra',
      '/offers/v1/health',
      '/v1/files/.well-known/x',
      '/auth/v1/.well-known/jwks.json',
      '/auth/.well-known',
      '/auth/well-known/jwks.json',
      '/.well-knownx/jwks.json',
      '',
    ])('should not exempt %s', (path) => {
      expect(isInfrastructurePath(path)).toBe(false);
    });
  });
});
