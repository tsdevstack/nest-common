import { describe, it, expect } from '@rstest/core';
import { toGcpSeverity } from './to-gcp-severity';

describe('toGcpSeverity', () => {
  describe('Standard use cases', () => {
    it("should map pino's levels to Cloud Logging severities", () => {
      expect(toGcpSeverity('trace')).toBe('DEBUG');
      expect(toGcpSeverity('debug')).toBe('DEBUG');
      expect(toGcpSeverity('info')).toBe('INFO');
      expect(toGcpSeverity('warn')).toBe('WARNING');
      expect(toGcpSeverity('error')).toBe('ERROR');
      expect(toGcpSeverity('fatal')).toBe('CRITICAL');
    });
  });

  describe('Edge cases', () => {
    it('should fall back to DEFAULT for an unknown label', () => {
      expect(toGcpSeverity('verbose')).toBe('DEFAULT');
    });
  });
});
