import { describe, it, expect, rs, beforeEach, type Mock } from '@rstest/core';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestLoggerAdapter } from './nest-logger-adapter';
import { markRequestLoggedError } from './mark-request-logged-error';
import type { LoggerService } from './logger.service';

type FakeLogger = {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
  child: Mock;
};

const stack =
  'Error: boom\n    at ItemsController.boom (/app/src/items.controller.ts:17:18)';

describe('NestLoggerAdapter', () => {
  let children: Map<string, FakeLogger>;
  let root: FakeLogger;
  let adapter: NestLoggerAdapter;

  const fakeLogger = (): FakeLogger => ({
    debug: rs.fn(),
    info: rs.fn(),
    warn: rs.fn(),
    error: rs.fn(),
    child: rs.fn(),
  });

  beforeEach(() => {
    children = new Map();
    root = fakeLogger();
    root.child.mockImplementation((context: string) => {
      const child = fakeLogger();
      children.set(context, child);
      return child;
    });
    adapter = new NestLoggerAdapter(root as unknown as LoggerService);
  });

  describe('Levels and context', () => {
    it('should log Nest log messages at info under their context', () => {
      adapter.log('Nest application successfully started', 'NestApplication');

      expect(root.child).toHaveBeenCalledWith('NestApplication');
      expect(children.get('NestApplication')!.info).toHaveBeenCalledWith(
        'Nest application successfully started',
        undefined,
      );
    });

    it('should map warn, debug, verbose and fatal', () => {
      adapter.warn('careful', 'A');
      adapter.debug('detail', 'A');
      adapter.verbose('more detail', 'A');
      adapter.fatal('dead', 'A');

      const a = children.get('A')!;
      expect(a.warn).toHaveBeenCalledWith('careful', undefined);
      expect(a.debug).toHaveBeenCalledWith('detail', undefined);
      expect(a.debug).toHaveBeenCalledWith('more detail', undefined);
      expect(a.error).toHaveBeenCalledWith('dead', undefined, undefined);
    });

    it('should create one child per context', () => {
      adapter.log('one', 'RoutesResolver');
      adapter.log('two', 'RoutesResolver');

      expect(root.child).toHaveBeenCalledTimes(1);
    });

    it('should use the root logger without a context', () => {
      adapter.log('no context');

      expect(root.child).not.toHaveBeenCalled();
      expect(root.info).toHaveBeenCalledWith('no context', undefined);
    });

    it('should keep extra params as details', () => {
      adapter.log('with extras', { a: 1 }, 'Ctx');

      expect(children.get('Ctx')!.info).toHaveBeenCalledWith('with extras', {
        details: [{ a: 1 }],
      });
    });

    it('should turn object messages into text', () => {
      adapter.log({ status: 'up' }, 'Ctx');

      expect(children.get('Ctx')!.info).toHaveBeenCalledWith(
        '{"status":"up"}',
        undefined,
      );
    });
  });

  describe('Errors', () => {
    it('should log an error object with its stack', () => {
      const error = new Error('Database exploded');
      adapter.error(error, undefined, 'ExceptionsHandler');

      expect(children.get('ExceptionsHandler')!.error).toHaveBeenCalledWith(
        'Database exploded',
        error,
        undefined,
      );
    });

    it('should keep a stack string passed next to a message', () => {
      adapter.error('boom', stack, 'Worker');

      expect(children.get('Worker')!.error).toHaveBeenCalledWith(
        'boom',
        { stack },
        undefined,
      );
    });

    it('should not take a stack string for the context', () => {
      adapter.error('boom', stack);

      expect(root.child).not.toHaveBeenCalled();
      expect(root.error).toHaveBeenCalledWith('boom', { stack }, undefined);
    });

    it('should keep an error passed after the message (logger.error(msg, err))', () => {
      const error = new Error('close failed');
      adapter.error('Shutdown error', error, 'Worker');

      expect(children.get('Worker')!.error).toHaveBeenCalledWith(
        'Shutdown error',
        error,
        undefined,
      );
    });

    it('should not lose an error passed to a non-error level', () => {
      adapter.warn('Retrying', new Error('timeout'), 'Ctx');

      expect(children.get('Ctx')!.warn).toHaveBeenCalledWith('Retrying', {
        details: [
          { name: 'Error', message: 'timeout', stack: expect.any(String) },
        ],
      });
    });

    it('should skip an error the request log already logged', () => {
      const error = new Error('Database exploded');
      markRequestLoggedError(error);

      adapter.error(error, undefined, 'ExceptionsHandler');

      expect(root.child).not.toHaveBeenCalled();
    });

    it('should still log an error the request log never saw (for example from a guard)', () => {
      const error = new Error('Redis is down');

      adapter.error(error, undefined, 'ExceptionsHandler');

      expect(children.get('ExceptionsHandler')!.error).toHaveBeenCalledWith(
        'Redis is down',
        error,
        undefined,
      );
    });

    it('should only skip marked errors coming from the exception handler', () => {
      const error = new Error('logged elsewhere');
      markRequestLoggedError(error);

      adapter.error(error, undefined, 'MyService');

      expect(children.get('MyService')!.error).toHaveBeenCalled();
    });
  });

  describe('Through Nest Logger', () => {
    it('should receive what Nest loggers send, with their context', () => {
      Logger.overrideLogger(adapter);
      try {
        new Logger('ExceptionsHandler').error(new Error('via Nest'));
        new Logger('RouterExplorer').log('Mapped {/api/ok, GET} route');
      } finally {
        // Back to Nest's default logger for other tests
        Logger.overrideLogger(new ConsoleLogger());
      }

      expect(children.get('ExceptionsHandler')!.error).toHaveBeenCalledWith(
        'via Nest',
        expect.any(Error),
        undefined,
      );
      expect(children.get('RouterExplorer')!.info).toHaveBeenCalledWith(
        'Mapped {/api/ok, GET} route',
        undefined,
      );
    });
  });
});
