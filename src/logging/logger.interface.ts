export interface LoggerModuleOptions {
  /**
   * Log level
   * Default: LOG_LEVEL env var or 'info'
   */
  level?: 'debug' | 'info' | 'warn' | 'error';

  /**
   * Paths to redact from logs (for PII protection)
   * Supports nested paths: 'user.email', '*.password', 'data[*].ssn'
   * Default: LOG_REDACT_PATHS env var (comma-separated) or common PII fields
   */
  redactPaths?: string[];

  /**
   * String to replace redacted values with
   * Default: '[REDACTED]'
   */
  redactCensor?: string;

  /**
   * Disable default PII redaction paths
   * When false, common paths like 'password', 'email', 'ssn' are auto-redacted
   * Default: false
   */
  disableDefaultRedaction?: boolean;
}

/**
 * Default paths to redact for common PII fields
 * These are applied unless disableDefaultRedaction is true
 */
export const DEFAULT_REDACT_PATHS = [
  'password',
  '*.password',
  'email',
  '*.email',
  'ssn',
  '*.ssn',
  'creditCard',
  '*.creditCard',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'apiKey',
  '*.apiKey',
];