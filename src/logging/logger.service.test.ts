import {
  describe,
  it,
  expect,
  rs,
  beforeEach,
  afterEach,
  type Mock,
} from '@rstest/core';

interface LoggerOptionsLike {
  formatters: { level: (label: string) => Record<string, string> };
}

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
import { ROOT_CONTEXT, TraceFlags, context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
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

    it('should share one pino instance with children and grandchildren', () => {
      const child = loggerService.child('Child');
      const grandchild = child.child('Grandchild');

      loggerService.info('root');
      child.info('child');
      grandchild.info('grandchild');

      expect(pino).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledTimes(3);
    });

    it('should keep the parent context out of a child', () => {
      loggerService.setContext('Parent');
      loggerService.child('Child').info('child message');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ context: 'Child' }),
      );
    });
  });

  describe('output format', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should write one compact line per entry locally', () => {
      process.env.NODE_ENV = 'development';
      new LoggerService().info('hello');

      expect(pino).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: {
            target: 'pino-pretty',
            options: expect.objectContaining({
              singleLine: true,
              messageFormat: '{if context}[{context}] {end}{msg}',
              ignore: 'pid,hostname,service,context,trace_id,span_id,http',
            }),
          },
        }),
      );
    });

    it('should write JSON without a transport in production', () => {
      process.env.NODE_ENV = 'production';
      new LoggerService().info('hello');

      const [options] = rs.mocked(pino).mock.calls[0] as unknown as [
        Record<string, unknown>,
      ];
      expect(options).not.toHaveProperty('transport');
    });
  });

  describe('service name', () => {
    const original = {
      SERVICE_NAME: process.env.SERVICE_NAME,
      WORKER_NAME: process.env.WORKER_NAME,
    };

    afterEach(() => {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });

    function baseService(): unknown {
      const [options] = rs.mocked(pino).mock.calls[0] as unknown as [
        { base: { service: unknown } },
      ];
      return options.base.service;
    }

    it('should name lines after the service', () => {
      process.env.SERVICE_NAME = 'auth-service';
      delete process.env.WORKER_NAME;
      new LoggerService().info('hello');

      expect(baseService()).toBe('auth-service');
    });

    it("should name a worker's lines after the worker", () => {
      process.env.SERVICE_NAME = 'auth-service';
      process.env.WORKER_NAME = 'auth-worker';
      new LoggerService().info('hello');

      expect(baseService()).toBe('auth-worker');
    });
  });
  describe('trace fields', () => {
    const span = {
      traceId: '5759e988bd862e3fe1be46a994272793',
      spanId: '53995c3f42cd8ad8',
      traceFlags: TraceFlags.SAMPLED,
    };
    const saved = {
      SECRETS_PROVIDER: process.env.SECRETS_PROVIDER,
      GCP_PROJECT_ID: process.env.GCP_PROJECT_ID,
    };

    beforeEach(() => {
      context.setGlobalContextManager(
        new AsyncLocalStorageContextManager().enable(),
      );
    });

    afterEach(() => {
      context.disable();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });

    it('should keep the correlation ID next to the trace', () => {
      process.env.SECRETS_PROVIDER = 'local';
      loggerService.setCorrelationId('req-1');

      context.with(trace.setSpanContext(ROOT_CONTEXT, span), () =>
        loggerService.info('in a request'),
      );

      expect(mockLogger.info).toHaveBeenCalledWith({
        trace_id: span.traceId,
        span_id: span.spanId,
        correlationId: 'req-1',
        msg: 'in a request',
      });
    });

    it("should link the line to its trace in GCP's console", () => {
      process.env.SECRETS_PROVIDER = 'gcp';
      process.env.GCP_PROJECT_ID = 'shop-dev';

      context.with(trace.setSpanContext(ROOT_CONTEXT, span), () =>
        loggerService.warn('slow'),
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          'logging.googleapis.com/trace': `projects/shop-dev/traces/${span.traceId}`,
          'logging.googleapis.com/spanId': span.spanId,
          'logging.googleapis.com/trace_sampled': true,
        }),
      );
    });

    it('should give each line a Cloud Logging severity on GCP only', () => {
      process.env.SECRETS_PROVIDER = 'gcp';
      new LoggerService().info('on gcp');
      process.env.SECRETS_PROVIDER = 'aws';
      new LoggerService().info('on aws');

      const [gcpOptions, awsOptions] = (
        pino as unknown as { mock: { calls: [LoggerOptionsLike][] } }
      ).mock.calls.map((call) => call[0]);
      expect(gcpOptions.formatters.level('warn')).toEqual({
        level: 'warn',
        severity: 'WARNING',
      });
      expect(awsOptions.formatters.level('warn')).toEqual({ level: 'warn' });
    });
  });
});
