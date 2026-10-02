/**
 * Frozen `v: 1` record fixtures. DO NOT CHANGE OR REMOVE.
 *
 * The record format is a public, versioned contract: records written by any
 * earlier auth-service copy (or a project's own tooling) must keep decoding,
 * and the encoder must keep producing byte-identical output for version 1.
 * A format change needs a new `v` and new fixtures next to these.
 *
 * V1_FULL's `expiresAt` (4102444800, 2100-01-01T00:00:00Z) must stay in the
 * future for the lifetime of the contract: the Kong plugin suites in the CLI
 * use the same record and expect it to be admitted.
 */
import { describe, it, expect } from '@rstest/core';
import { decodeApiKeyRecord } from './decode-api-key-record';
import { encodeApiKeyRecord } from './encode-api-key-record';
import { buildApiKeyRecordKey } from './build-api-key-record-key';
import { buildApiKeyCounterKey } from './build-api-key-counter-key';
import { buildApiKeyLastUsedKey } from './build-api-key-last-used-key';
import { hashApiKey } from './hash-api-key';
import {
  API_KEY_INDEX_MARKER_KEY,
  API_KEY_REBUILD_LOCK_KEY,
} from './api-keys.constants';

const V1_FULL =
  '{"v":1,"id":"c0a8f1d2-5b6e-4f3a-9d7c-1e2f3a4b5c6d","consumer":"acme-corp","status":"active","limits":{"minute":60,"hour":1000,"day":10000,"week":50000,"month":100000},"expiresAt":4102444800}';
const V1_MINIMAL =
  '{"v":1,"id":"clx1234567890abcdef","consumer":"acme-corp","status":"active","limits":{}}';
const V1_REVOKED =
  '{"v":1,"id":"clx1234567890abcdef","consumer":"acme-corp","status":"revoked","limits":{"minute":5}}';

describe('API key record v1 fixture (frozen contract)', () => {
  it('should decode the full v1 record', () => {
    expect(decodeApiKeyRecord(V1_FULL)).toEqual({
      v: 1,
      id: 'c0a8f1d2-5b6e-4f3a-9d7c-1e2f3a4b5c6d',
      consumer: 'acme-corp',
      status: 'active',
      limits: {
        minute: 60,
        hour: 1000,
        day: 10000,
        week: 50000,
        month: 100000,
      },
      expiresAt: 4102444800,
    });
  });

  it('should re-encode every v1 fixture byte for byte', () => {
    for (const fixture of [V1_FULL, V1_MINIMAL, V1_REVOKED]) {
      expect(encodeApiKeyRecord(decodeApiKeyRecord(fixture))).toBe(fixture);
    }
  });

  it('should keep the v1 key layout', () => {
    const hash = hashApiKey('tsk_fixture');
    expect(hash).toBe(
      'bfad4f0d3d72e80dc75759f78d0b0f174e5fcf8ea0f2ce09fc1ae9d203dae693',
    );
    const now = 1790709764; // 2026-09-29T19:22:44Z
    expect(buildApiKeyRecordKey(hash)).toBe(`apikey:{${hash}}:rec`);
    expect(buildApiKeyLastUsedKey(hash)).toBe(`apikey:{${hash}}:lu`);
    expect(buildApiKeyCounterKey(hash, 'minute', now)).toBe(
      `apikey:{${hash}}:min:1790709720`,
    );
    expect(buildApiKeyCounterKey(hash, 'hour', now)).toBe(
      `apikey:{${hash}}:hour:1790708400`,
    );
    expect(buildApiKeyCounterKey(hash, 'day', now)).toBe(
      `apikey:{${hash}}:day:1790640000`,
    );
    expect(buildApiKeyCounterKey(hash, 'week', now)).toBe(
      `apikey:{${hash}}:week:1790553600`,
    );
    expect(buildApiKeyCounterKey(hash, 'month', now)).toBe(
      `apikey:{${hash}}:month:2026-09`,
    );
    expect(API_KEY_INDEX_MARKER_KEY).toBe('apikey:meta');
    expect(API_KEY_REBUILD_LOCK_KEY).toBe('apikey:rebuild-lock');
  });
});
