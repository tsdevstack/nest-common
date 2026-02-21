import { describe, it, expect } from '@rstest/core';

import { filterForwardHeaders } from './filter-forward-headers';

describe('filterForwardHeaders', () => {
  describe('Standard forwarding', () => {
    it('should forward safe headers', () => {
      const headers = {
        authorization: 'Bearer token',
        'x-request-id': '123',
        'accept-language': 'en',
      };

      const result = filterForwardHeaders(headers);

      expect(result).toEqual({
        authorization: 'Bearer token',
        'x-request-id': '123',
        'accept-language': 'en',
      });
    });

    it('should return empty object for empty headers', () => {
      const result = filterForwardHeaders({});
      expect(result).toEqual({});
    });
  });

  describe('Connection headers filtering', () => {
    it('should skip connection header', () => {
      const result = filterForwardHeaders({ connection: 'keep-alive' });
      expect(result).toEqual({});
    });

    it('should skip keep-alive header', () => {
      const result = filterForwardHeaders({ 'keep-alive': 'timeout=5' });
      expect(result).toEqual({});
    });

    it('should skip transfer-encoding header', () => {
      const result = filterForwardHeaders({ 'transfer-encoding': 'chunked' });
      expect(result).toEqual({});
    });

    it('should skip upgrade header', () => {
      const result = filterForwardHeaders({ upgrade: 'websocket' });
      expect(result).toEqual({});
    });
  });

  describe('Host header filtering', () => {
    it('should skip host header', () => {
      const result = filterForwardHeaders({ host: 'example.com' });
      expect(result).toEqual({});
    });
  });

  describe('Content headers filtering', () => {
    it('should skip content-length header', () => {
      const result = filterForwardHeaders({ 'content-length': '42' });
      expect(result).toEqual({});
    });

    it('should skip content-encoding header', () => {
      const result = filterForwardHeaders({ 'content-encoding': 'gzip' });
      expect(result).toEqual({});
    });
  });

  describe('Hop-by-hop headers filtering', () => {
    it('should skip proxy-authenticate header', () => {
      const result = filterForwardHeaders({
        'proxy-authenticate': 'Basic',
      });
      expect(result).toEqual({});
    });

    it('should skip proxy-authorization header', () => {
      const result = filterForwardHeaders({
        'proxy-authorization': 'Basic abc',
      });
      expect(result).toEqual({});
    });

    it('should skip te header', () => {
      const result = filterForwardHeaders({ te: 'trailers' });
      expect(result).toEqual({});
    });

    it('should skip trailer header', () => {
      const result = filterForwardHeaders({ trailer: 'Expires' });
      expect(result).toEqual({});
    });
  });

  describe('Array values', () => {
    it('should skip array header values like set-cookie', () => {
      const headers = {
        'set-cookie': ['a=1', 'b=2'],
        authorization: 'Bearer token',
      };

      const result = filterForwardHeaders(headers);

      expect(result).toEqual({ authorization: 'Bearer token' });
    });
  });

  describe('Mixed headers', () => {
    it('should filter correctly with mix of safe and unsafe headers', () => {
      const headers = {
        authorization: 'Bearer token',
        host: 'example.com',
        'x-forwarded-for': '1.2.3.4',
        connection: 'keep-alive',
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
      };

      const result = filterForwardHeaders(headers);

      expect(result).toEqual({
        authorization: 'Bearer token',
        'x-forwarded-for': '1.2.3.4',
        'content-type': 'application/json',
      });
    });

    it('should preserve original key casing', () => {
      const headers = {
        Authorization: 'Bearer token',
        'X-Custom-Header': 'value',
      };

      const result = filterForwardHeaders(headers);

      expect(result).toEqual({
        Authorization: 'Bearer token',
        'X-Custom-Header': 'value',
      });
    });
  });
});
