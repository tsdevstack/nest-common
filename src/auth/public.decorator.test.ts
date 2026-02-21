import { describe, it, expect } from '@rstest/core';

import { Public, IS_PUBLIC_KEY } from './public.decorator';

describe('Public decorator', () => {
  it('should export IS_PUBLIC_KEY constant', () => {
    expect(IS_PUBLIC_KEY).toBe('isPublic');
  });

  it('should return a decorator function', () => {
    const decorator = Public();
    expect(typeof decorator).toBe('function');
  });
});
