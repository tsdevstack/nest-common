import { describe, it, expect } from '@rstest/core';
import { parseStreamEntry } from './parse-stream-entry';

describe('parseStreamEntry', () => {
  it('should parse a stream entry with data field', () => {
    const message = parseStreamEntry(
      '1709312000000-0',
      ['data', '{"userId":"123","email":"test@example.com"}'],
      'user-created',
      0,
    );

    expect(message.id).toBe('1709312000000-0');
    expect(message.topic).toBe('user-created');
    expect(message.data).toEqual({ userId: '123', email: 'test@example.com' });
    expect(message.publishedAt).toEqual(new Date(1709312000000));
    expect(message.retryCount).toBe(0);
  });

  it('should use empty object when no data field found', () => {
    const message = parseStreamEntry(
      '1709312000000-0',
      ['other', 'value'],
      'test-topic',
      2,
    );

    expect(message.data).toEqual({});
    expect(message.retryCount).toBe(2);
  });

  it('should handle multiple fields and find data', () => {
    const message = parseStreamEntry(
      '1709312000000-0',
      ['key1', 'val1', 'data', '{"foo":"bar"}', 'key2', 'val2'],
      'test-topic',
      0,
    );

    expect(message.data).toEqual({ foo: 'bar' });
  });
});
