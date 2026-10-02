import { describe, it, expect } from '@rstest/core';
import { getRequestPartner } from './get-request-partner';

describe('getRequestPartner', () => {
  it('should return the API key consumer', () => {
    expect(
      getRequestPartner({ apiKey: { id: 'key-1', consumer: 'acme-corp' } }),
    ).toBe('acme-corp');
  });

  it('should return undefined without an API key', () => {
    expect(getRequestPartner({})).toBeUndefined();
  });
});
