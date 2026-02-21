import { describe, it, expect, rs, beforeEach, type Mock } from '@rstest/core';

// Store mock references globally so they can be accessed in tests
let mockLogger: {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
};

rs.mock('pino', () => {
  const logger = {
    debug: rs.fn(),
    info: rs.fn(),
    warn: rs.fn(),
    error: rs.fn(),
  };

  const pinoFn = rs.fn(() => logger);
  (pinoFn as unknown as Record<string, unknown>).stdTimeFunctions = {
    isoTime: rs.fn(),
  };

  // Expose the logger so tests can access it
  (pinoFn as unknown as Record<string, unknown>).__mockLogger = logger;

  return { default: pinoFn };
});

// Import after mock is set up
import pino from 'pino';
import { LoggerService } from './logger.service';

describe('LoggerService', () => {
  let loggerService: LoggerService;

  beforeEach(() => {
    // Get the mock logger reference
    mockLogger = (pino as unknown as Record<string, unknown>)
      .__mockLogger as typeof mockLogger;
    rs.clearAllMocks();
    loggerService = new LoggerService();
  });

  describe('logging methods', () => {
    it('should log debug messages', () => {
      loggerService.debug('debug message');
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ msg: 'debug message' }),
      );
    });

    it('should log info messages', () => {
      loggerService.info('info message');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ msg: 'info message' }),
      );
    });

    it('should log warn messages', () => {
      loggerService.warn('warn message');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ msg: 'warn message' }),
      );
    });

    it('should log error messages', () => {
      loggerService.error('error message');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ msg: 'error message' }),
      );
    });

    it('should include context in log messages', () => {
      loggerService.info('message', { userId: 123, action: 'login' });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'message',
          userId: 123,
          action: 'login',
        }),
      );
    });
  });

  describe('context management', () => {
    it('should include context name in log messages', () => {
      loggerService.setContext('UserService');
      loggerService.info('test message');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          context: 'UserService',
          msg: 'test message',
        }),
      );
    });
  });

  describe('correlation ID', () => {
    it('should include correlation ID in log messages', () => {
      loggerService.setCorrelationId('abc-123');
      loggerService.info('test message');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'abc-123',
          msg: 'test message',
        }),
      );
    });
  });

  describe('error logging', () => {
    it('should log Error objects with stack trace', () => {
      const error = new Error('Something went wrong');
      loggerService.error('Operation failed', error);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'Operation failed',
          error: expect.objectContaining({
            name: 'Error',
            message: 'Something went wrong',
            stack: expect.any(String),
          }),
        }),
      );
    });

    it('should log non-Error objects', () => {
      loggerService.error('Operation failed', { code: 'ERR_001' });
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'Operation failed',
          error: { code: 'ERR_001' },
        }),
      );
    });

    it('should log error with additional context', () => {
      const error = new Error('DB error');
      loggerService.error('Query failed', error, { table: 'users' });
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'Query failed',
          table: 'users',
          error: expect.objectContaining({
            message: 'DB error',
          }),
        }),
      );
    });
  });

  describe('child logger', () => {
    it('should create child logger with context', () => {
      const child = loggerService.child('ChildContext');
      child.info('child message');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          context: 'ChildContext',
          msg: 'child message',
        }),
      );
    });

    it('should inherit correlation ID in child logger', () => {
      loggerService.setCorrelationId('parent-id');
      const child = loggerService.child('ChildContext');
      child.info('child message');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          context: 'ChildContext',
          correlationId: 'parent-id',
          msg: 'child message',
        }),
      );
    });
  });
});
