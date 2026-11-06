import { GCP_SEVERITY_BY_PINO_LEVEL } from './logging.constants';

/**
 * The Cloud Logging severity for a pino level label (DEFAULT for a label
 * pino does not have)
 */
export function toGcpSeverity(level: string): string {
  return GCP_SEVERITY_BY_PINO_LEVEL[level] ?? 'DEFAULT';
}
