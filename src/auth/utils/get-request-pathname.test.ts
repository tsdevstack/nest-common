import { describe, it, expect } from '@rstest/core';
import { getRequestPathname } from './get-request-pathname';

describe('getRequestPathname', () => {
  it('should return the url when it has no query string', () => {
    expect(getRequestPathname({ url: '/offers/v1/plans' })).toBe(
      '/offers/v1/plans',
    );
  });

  it('should drop the query string', () => {
    expect(getRequestPathname({ url: '/offers/v1/plans?x=/health' })).toBe(
      '/offers/v1/plans',
    );
  });

  it('should drop a fragment', () => {
    expect(getRequestPathname({ url: '/a#/metrics' })).toBe('/a');
  });

  it('should fall back to path', () => {
    expect(getRequestPathname({ path: '/health' })).toBe('/health');
  });

  it('should return an empty string when neither is set', () => {
    expect(getRequestPathname({})).toBe('');
  });
});
