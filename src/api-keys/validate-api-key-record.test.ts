import { describe, it, expect } from '@rstest/core';
import { validateApiKeyRecord } from './validate-api-key-record';

const valid = {
  v: 1,
  id: 'c0a8f1d2-5b6e-4f3a-9d7c-1e2f3a4b5c6d',
  consumer: 'acme-corp',
  status: 'active',
  limits: { minute: 60, month: 100000 },
  expiresAt: 1793491200,
};

function errorsOf(value: unknown): string[] {
  const result = validateApiKeyRecord(value);
  return result.valid ? [] : result.errors;
}

describe('validateApiKeyRecord', () => {
  describe('Standard use cases', () => {
    it('should accept a full record', () => {
      const result = validateApiKeyRecord(valid);
      expect(result).toEqual({ valid: true, record: valid });
    });

    it('should accept a minimal record (no limits, no expiry)', () => {
      const minimal = {
        v: 1,
        id: 'k1',
        consumer: 'acme',
        status: 'revoked',
        limits: {},
      };
      expect(validateApiKeyRecord(minimal)).toEqual({
        valid: true,
        record: minimal,
      });
    });

    it('should drop unknown extra fields', () => {
      const result = validateApiKeyRecord({ ...valid, scopes: ['x'] });
      expect(result.valid).toBe(true);
      expect(result.valid && 'scopes' in result.record).toBe(false);
    });
  });

  describe('Rejections', () => {
    it('should reject non-objects', () => {
      expect(errorsOf(null)).toHaveLength(1);
      expect(errorsOf([])).toHaveLength(1);
      expect(errorsOf('{}')).toHaveLength(1);
    });

    it('should reject unknown versions', () => {
      expect(errorsOf({ ...valid, v: 2 })[0]).toMatch(/^v must be/);
      expect(errorsOf({ ...valid, v: '1' })).toHaveLength(1);
      const { v: _v, ...noVersion } = valid;
      expect(errorsOf(noVersion)).toHaveLength(1);
    });

    it('should reject bad ids and consumers (they become header values)', () => {
      expect(errorsOf({ ...valid, id: '' })).toHaveLength(1);
      expect(errorsOf({ ...valid, id: 'a\r\nX-Evil: 1' })).toHaveLength(1);
      expect(errorsOf({ ...valid, consumer: 'a b' })).toHaveLength(1);
      expect(errorsOf({ ...valid, consumer: 'x'.repeat(129) })).toHaveLength(1);
      expect(errorsOf({ ...valid, consumer: 42 })).toHaveLength(1);
    });

    it('should reject unknown statuses (case-sensitive)', () => {
      expect(errorsOf({ ...valid, status: 'ACTIVE' })).toHaveLength(1);
      expect(errorsOf({ ...valid, status: 'expired' })).toHaveLength(1);
    });

    it('should reject bad limits', () => {
      expect(errorsOf({ ...valid, limits: null })).toHaveLength(1);
      expect(errorsOf({ ...valid, limits: [] })).toHaveLength(1);
      expect(errorsOf({ ...valid, limits: { second: 1 } })).toHaveLength(1);
      expect(errorsOf({ ...valid, limits: { minute: 0 } })).toHaveLength(1);
      expect(errorsOf({ ...valid, limits: { minute: 1.5 } })).toHaveLength(1);
      expect(errorsOf({ ...valid, limits: { minute: null } })).toHaveLength(1);
      expect(errorsOf({ ...valid, limits: { minute: '10' } })).toHaveLength(1);
    });

    it('should cap limits at 2^31 - 1 (Postgres INTEGER, same as the writer)', () => {
      expect(errorsOf({ ...valid, limits: { month: 2147483647 } })).toEqual([]);
      expect(errorsOf({ ...valid, limits: { month: 2147483648 } })[0]).toBe(
        'limits.month must be an integer from 1 to 2147483647',
      );
    });

    it('should reject null or non-integer expiry (absent fields are omitted)', () => {
      expect(errorsOf({ ...valid, expiresAt: null })).toHaveLength(1);
      expect(errorsOf({ ...valid, expiresAt: 1793491200.5 })).toHaveLength(1);
      expect(errorsOf({ ...valid, expiresAt: '2026-10-01' })).toHaveLength(1);
      // milliseconds are still integers; seconds is a documented rule, not checkable
      expect(errorsOf({ ...valid, expiresAt: 0 })).toHaveLength(1);
    });

    it('should report every broken rule at once', () => {
      expect(errorsOf({ v: 9, status: 'x', limits: 1 })).toHaveLength(5);
    });
  });
});
