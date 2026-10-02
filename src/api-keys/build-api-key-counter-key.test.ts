import { describe, it, expect } from '@rstest/core';
import { buildApiKeyCounterKey } from './build-api-key-counter-key';
import { buildApiKeyRecordKey } from './build-api-key-record-key';
import { buildApiKeyLastUsedKey } from './build-api-key-last-used-key';
import { API_KEY_WINDOWS } from './api-keys.constants';

const HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const NOW = 1790709764; // 2026-09-29T19:22:44Z

/** The part of a key name Redis Cluster hashes (first {...} with content) */
function hashTag(key: string): string {
  const open = key.indexOf('{');
  const close = key.indexOf('}', open + 1);
  return open >= 0 && close > open + 1 ? key.slice(open + 1, close) : key;
}

describe('buildApiKeyCounterKey', () => {
  it('should build every window counter name', () => {
    expect(buildApiKeyCounterKey(HASH, 'minute', NOW)).toBe(
      `apikey:{${HASH}}:min:1790709720`,
    );
    expect(buildApiKeyCounterKey(HASH, 'hour', NOW)).toBe(
      `apikey:{${HASH}}:hour:1790708400`,
    );
    expect(buildApiKeyCounterKey(HASH, 'day', NOW)).toBe(
      `apikey:{${HASH}}:day:1790640000`,
    );
    expect(buildApiKeyCounterKey(HASH, 'week', NOW)).toBe(
      `apikey:{${HASH}}:week:1790553600`,
    );
    expect(buildApiKeyCounterKey(HASH, 'month', NOW)).toBe(
      `apikey:{${HASH}}:month:2026-09`,
    );
  });

  it('should keep every entry of one key in the same hash slot', () => {
    const names = [
      buildApiKeyRecordKey(HASH),
      buildApiKeyLastUsedKey(HASH),
      ...API_KEY_WINDOWS.map((window) =>
        buildApiKeyCounterKey(HASH, window, NOW),
      ),
    ];
    expect(new Set(names.map(hashTag))).toEqual(new Set([HASH]));
  });

  it('should refuse anything but a sha256 hex digest', () => {
    expect(() => buildApiKeyCounterKey('abc', 'minute', NOW)).toThrow();
  });
});
