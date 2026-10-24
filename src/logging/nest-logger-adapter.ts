/**
 * Nest Logger Adapter
 *
 * Routes Nest's built-in logger (startup messages, the exception handler,
 * and `new Logger()` in framework classes) through LoggerService. Without
 * it, Nest prints coloured plain text: one cloud log entry per line of a
 * stack trace, next to the JSON entries of the app.
 *
 * Nest calls `method(message, ...params)` and appends the logger's context
 * as the last param; `error` may also carry a stack string.
 */

import type { LoggerService as NestLoggerService } from '@nestjs/common';
import type { LoggerService } from './logger.service';
import { isRequestLoggedError } from './is-request-logged-error';
import {
  NEST_EXCEPTIONS_HANDLER_CONTEXT,
  STACK_TRACE_PATTERN,
} from './logging.constants';

type Level = 'debug' | 'info' | 'warn';

export class NestLoggerAdapter implements NestLoggerService {
  private readonly loggers = new Map<string, LoggerService>();

  constructor(private readonly root: LoggerService) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.error(message, ...params);
  }

  error(message: unknown, ...params: unknown[]): void {
    const { context, stack, extra } = this.splitParams(params);

    // The request log already logged this error, with its request
    if (
      context === NEST_EXCEPTIONS_HANDLER_CONTEXT &&
      isRequestLoggedError(message)
    ) {
      return;
    }

    const logger = this.loggerFor(context);
    if (message instanceof Error) {
      logger.error(message.message, message, this.extraFields(extra));
      return;
    }

    // logger.error('Shutdown error', err): the error comes as a param
    const errorParam = extra.find((param) => param instanceof Error);
    const otherExtra = extra.filter((param) => param !== errorParam);
    logger.error(
      this.toText(message),
      errorParam ?? (stack === undefined ? undefined : { stack }),
      this.extraFields(otherExtra),
    );
  }

  private write(level: Level, message: unknown, params: unknown[]): void {
    const { context, extra } = this.splitParams(params);
    this.loggerFor(context)[level](
      this.toText(message),
      this.extraFields(extra),
    );
  }

  /**
   * Context is the last param when it is a string that is not a stack
   * trace; a stack trace may come before it (error only).
   */
  private splitParams(params: unknown[]): {
    context?: string;
    stack?: string;
    extra: unknown[];
  } {
    let rest = params;
    let context: string | undefined;
    const last = rest[rest.length - 1];
    if (typeof last === 'string' && !STACK_TRACE_PATTERN.test(last)) {
      context = last;
      rest = rest.slice(0, -1);
    }

    let stack: string | undefined;
    const extra: unknown[] = [];
    for (const param of rest) {
      if (
        stack === undefined &&
        typeof param === 'string' &&
        STACK_TRACE_PATTERN.test(param)
      ) {
        stack = param;
      } else if (param !== undefined) {
        extra.push(param);
      }
    }

    return { context, stack, extra };
  }

  private loggerFor(context: string | undefined): LoggerService {
    if (!context) {
      return this.root;
    }
    let logger = this.loggers.get(context);
    if (!logger) {
      logger = this.root.child(context);
      this.loggers.set(context, logger);
    }
    return logger;
  }

  private toText(message: unknown): string {
    if (typeof message === 'string') {
      return message;
    }
    if (message instanceof Error) {
      return message.message;
    }
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }

  private extraFields(extra: unknown[]): { details: unknown[] } | undefined {
    if (extra.length === 0) {
      return undefined;
    }
    // Error properties are not enumerable: they would serialize as {}
    return {
      details: extra.map((param) =>
        param instanceof Error
          ? { name: param.name, message: param.message, stack: param.stack }
          : param,
      ),
    };
  }
}
