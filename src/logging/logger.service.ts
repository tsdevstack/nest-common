import { Injectable, Scope, Inject, Optional } from '@nestjs/common';
import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';
import { trace } from '@opentelemetry/api';
import {
  DEFAULT_REDACT_PATHS,
  type LoggerModuleOptions,
} from './logger.interface';

export interface LogContext {
  [key: string]: unknown;
}

@Injectable({ scope: Scope.DEFAULT })
export class LoggerService {
  /** Created on first use; children share their parent's (see child()) */
  private pinoLogger?: PinoLogger;
  private context?: string;
  private correlationId?: string;
  private readonly options: LoggerModuleOptions;

  constructor(
    @Optional()
    @Inject('LOGGER_MODULE_OPTIONS')
    moduleOptions?: LoggerModuleOptions,
  ) {
    this.options = moduleOptions || {};
  }

  /**
   * The pino instance, created on first use so that a child logger can take
   * its parent's instead of building its own (locally, every instance with
   * the pretty transport runs its own worker thread).
   */
  private get logger(): PinoLogger {
    if (!this.pinoLogger) {
      this.pinoLogger = this.createPinoLogger();
    }
    return this.pinoLogger;
  }

  private createPinoLogger(): PinoLogger {
    const logLevel = this.options.level || process.env.LOG_LEVEL || 'info';
    const isPretty = process.env.NODE_ENV !== 'production';

    // Build redaction paths for PII protection
    const redactPaths = this.buildRedactPaths();

    const pinoOptions: LoggerOptions = {
      level: logLevel,
      formatters: {
        level: (label) => ({ level: label }),
      },
      base: {
        service: process.env.SERVICE_NAME || 'unknown',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      // Configure redaction for PII protection
      ...(redactPaths.length > 0 && {
        redact: {
          paths: redactPaths,
          censor: this.options.redactCensor || '[REDACTED]',
        },
      }),
    };

    // In development, use pino-pretty for readable logs: one line per entry,
    // "[Context] message". Locally the service name is already on every line
    // (lerna prefixes it); trace ids and the request fields (http) stay in
    // the JSON logs of deployed services.
    if (isPretty) {
      return pino({
        ...pinoOptions,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname,service,context,trace_id,span_id,http',
            messageFormat: '{if context}[{context}] {end}{msg}',
          },
        },
      });
    }

    // In production, output JSON logs
    return pino(pinoOptions);
  }

  /**
   * Build the list of paths to redact from logs
   */
  private buildRedactPaths(): string[] {
    const paths: string[] = [];

    // Add default PII paths unless disabled
    if (!this.options.disableDefaultRedaction) {
      paths.push(...DEFAULT_REDACT_PATHS);
    }

    // Add custom paths from options
    if (this.options.redactPaths) {
      paths.push(...this.options.redactPaths);
    }

    // Add paths from environment variable (comma-separated)
    const envPaths = process.env.LOG_REDACT_PATHS;
    if (envPaths) {
      paths.push(...envPaths.split(',').map((p) => p.trim()));
    }

    // Remove duplicates
    return [...new Set(paths)];
  }

  setContext(context: string): void {
    this.context = context;
  }

  setCorrelationId(correlationId: string): void {
    this.correlationId = correlationId;
  }

  /**
   * Get trace context from active OTEL span
   */
  private getTraceContext(): { trace_id?: string; span_id?: string } {
    const activeSpan = trace.getActiveSpan();
    if (!activeSpan) {
      return {};
    }

    const spanContext = activeSpan.spanContext();
    return {
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
    };
  }

  private formatMessage(message: string, context?: LogContext): object {
    const traceContext = this.getTraceContext();

    return {
      ...(this.context && { context: this.context }),
      // Include trace context if available, otherwise fall back to correlationId
      ...traceContext,
      ...(this.correlationId &&
        !traceContext.trace_id && { correlationId: this.correlationId }),
      msg: message,
      ...context,
    };
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(this.formatMessage(message, context));
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(this.formatMessage(message, context));
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(this.formatMessage(message, context));
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext: LogContext = { ...context };

    if (error instanceof Error) {
      errorContext.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    } else if (error !== undefined) {
      errorContext.error = error;
    }

    this.logger.error(this.formatMessage(message, errorContext));
  }

  /**
   * Create a child logger with a specific context
   * Useful for class-level loggers
   */
  child(context: string): LoggerService {
    const child = new LoggerService(this.options);
    // Share the pino instance: a child only adds its context
    child.pinoLogger = this.logger;
    child.setContext(context);
    if (this.correlationId) {
      child.setCorrelationId(this.correlationId);
    }
    return child;
  }
}
