import { describe, it, expect } from '@rstest/core';
import { getClientIp } from './get-client-ip';

describe('getClientIp', () => {
  describe('Standard use cases', () => {
    it('should use X-Real-IP for requests that came through Kong', () => {
      expect(
        getClientIp({
          headers: { 'x-real-ip': '203.0.113.7' },
          socket: { remoteAddress: '10.0.0.5' },
          viaGateway: true,
        }),
      ).toBe('203.0.113.7');
    });

    it('should prefer X-Tsdevstack-Real-IP (the visitor a trusted frontend named) through Kong', () => {
      expect(
        getClientIp({
          headers: {
            'x-tsdevstack-real-ip': '198.51.100.23',
            'x-real-ip': '203.0.113.7',
          },
          socket: { remoteAddress: '10.0.0.5' },
          viaGateway: true,
        }),
      ).toBe('198.51.100.23');
    });

    it('should ignore X-Tsdevstack-Real-IP without the gateway flag', () => {
      expect(
        getClientIp({
          headers: { 'x-tsdevstack-real-ip': '198.51.100.23' },
          socket: { remoteAddress: '10.0.0.5' },
        }),
      ).toBe('10.0.0.5');
    });

    it('should use the socket address without the gateway flag', () => {
      expect(
        getClientIp({
          headers: { 'x-real-ip': '203.0.113.7' },
          socket: { remoteAddress: '10.0.0.5' },
        }),
      ).toBe('10.0.0.5');
    });

    it('should never use X-Forwarded-For (client-controlled first entry)', () => {
      expect(
        getClientIp({
          headers: {
            'x-forwarded-for': '1.2.3.4, 203.0.113.7',
            'x-real-ip': '203.0.113.7',
          },
          socket: { remoteAddress: '10.0.0.5' },
          viaGateway: true,
        }),
      ).toBe('203.0.113.7');
      expect(
        getClientIp({
          headers: { 'x-forwarded-for': '1.2.3.4' },
          socket: { remoteAddress: '10.0.0.5' },
        }),
      ).toBe('10.0.0.5');
    });
  });

  describe('Edge cases', () => {
    it('should fall back to X-Real-IP when Kong sent no X-Tsdevstack-Real-IP', () => {
      expect(
        getClientIp({
          headers: { 'x-tsdevstack-real-ip': '  ', 'x-real-ip': '203.0.113.7' },
          viaGateway: true,
        }),
      ).toBe('203.0.113.7');
    });

    it('should fall back to the socket address when Kong sent no X-Real-IP', () => {
      expect(
        getClientIp({
          headers: {},
          socket: { remoteAddress: '10.0.0.5' },
          viaGateway: true,
        }),
      ).toBe('10.0.0.5');
    });

    it('should take the first value of a repeated header', () => {
      expect(
        getClientIp({
          headers: { 'x-real-ip': ['203.0.113.7', '1.2.3.4'] },
          viaGateway: true,
        }),
      ).toBe('203.0.113.7');
    });

    it('should return unknown without any address', () => {
      expect(getClientIp({ headers: {} })).toBe('unknown');
    });
  });
});
