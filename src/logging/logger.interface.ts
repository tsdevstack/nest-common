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
 * Default paths to redact: common PII fields, credentials and the request
 * headers that carry them. These are applied unless disableDefaultRedaction
 * is true.
 *
 * Each name is matched at the top of the entry and one level down
 * ({ password }, { user: { password } }), not deeper: pino checks every path
 * on every line. Header names are lowercase, as Node gives request headers
 * ({ headers: req.headers }).
 */
export const DEFAULT_REDACT_PATHS = [
  'password',
  '*.password',
  'newPassword',
  '*.newPassword',
  'currentPassword',
  '*.currentPassword',
  'passwordHash',
  '*.passwordHash',
  'email',
  '*.email',
  'ssn',
  '*.ssn',
  'creditCard',
  '*.creditCard',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'secret',
  '*.secret',
  'privateKey',
  '*.privateKey',
  'apiKey',
  '*.apiKey',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  '["set-cookie"]',
  '*["set-cookie"]',
  '["x-api-key"]',
  '*["x-api-key"]',
  '["x-kong-trust"]',
  '*["x-kong-trust"]',
  '["x-tsdevstack-frontend-token"]',
  '*["x-tsdevstack-frontend-token"]',
];
