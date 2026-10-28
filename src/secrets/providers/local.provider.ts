import * as fs from 'fs';
import * as path from 'path';
import { SecretsProvider } from '../secrets.interface';
import {
  LOCAL_SHARED_SECRETS_SECTION,
  SHARED_SECRETS_SCOPE,
} from '../secrets.constants';

/**
 * Local Secrets Provider
 *
 * Reads secrets from .secrets.local.json file in the project root. The file
 * is read again on every read; SecretsService caches the values.
 *
 * File format (the top-level `secrets` block is the shared scope):
 * {
 *   "secrets": {
 *     "KONG_TRUST_TOKEN": "...",
 *     "REDIS_PASSWORD": "..."
 *   },
 *   "auth-service": {
 *     "DATABASE_URL": "postgresql://...",
 *     "AUTH_SECRET": "..."
 *   }
 * }
 */
export class LocalSecretsProvider implements SecretsProvider {
  private secrets: Record<string, Record<string, string>>;
  private secretsFilePath: string;

  constructor(secretsFilePath: string = '.secrets.local.json') {
    // Find the project root (where .secrets.local.json should be)
    this.secretsFilePath = this.findProjectRoot(secretsFilePath);
    this.secrets = this.loadSecretsFile();

    // NODE_ENV hack: Next.js requires this in process.env
    // Check if NODE_ENV exists in secrets and inject into process.env
    const topLevelSecrets = this.secrets['secrets'];
    if (topLevelSecrets && topLevelSecrets['NODE_ENV']) {
      process.env.NODE_ENV = topLevelSecrets['NODE_ENV'];
    }
  }

  /**
   * Injects the service's DATABASE_URL into process.env for Prisma
   * (Prisma schema uses env("DATABASE_URL") before SecretsService is available)
   */
  setServiceName(serviceName: string): void {
    // DATABASE_URL injection: Prisma requires this in process.env
    // Inject service-specific DATABASE_URL if it exists
    const serviceSecrets = this.secrets[serviceName];
    if (serviceSecrets && serviceSecrets['DATABASE_URL']) {
      process.env.DATABASE_URL = serviceSecrets['DATABASE_URL'];
    }
  }

  /**
   * Find the project root by looking for .secrets.local.json
   * Walks up the directory tree from current working directory
   */
  private findProjectRoot(filename: string): string {
    let currentDir = process.cwd();
    const maxDepth = 10; // Prevent infinite loop
    let depth = 0;

    while (depth < maxDepth) {
      const secretsPath = path.join(currentDir, filename);

      if (fs.existsSync(secretsPath)) {
        return secretsPath;
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        // Reached filesystem root
        break;
      }

      currentDir = parentDir;
      depth++;
    }

    // If not found, return the expected path from cwd
    return path.join(process.cwd(), filename);
  }

  /**
   * Load and parse the secrets file
   */
  private loadSecretsFile(): Record<string, Record<string, string>> {
    try {
      if (!fs.existsSync(this.secretsFilePath)) {
        throw new Error(
          `Secrets file not found: ${this.secretsFilePath}\n\n` +
            'Please create .secrets.local.json in your project root.\n' +
            'See docs/secrets-management-strategy.md for details.',
        );
      }

      const fileContent = fs.readFileSync(this.secretsFilePath, 'utf-8');
      const secrets = JSON.parse(fileContent);

      // Validate structure
      if (typeof secrets !== 'object' || secrets === null) {
        throw new Error(
          `Invalid secrets file format. Expected object, got ${typeof secrets}`,
        );
      }

      return secrets;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Failed to parse secrets file: ${this.secretsFilePath}\n` +
            `JSON syntax error: ${error.message}`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  /**
   * Get provider name
   */
  getName(): string {
    return 'local';
  }

  /**
   * Get the path to the secrets file (for debugging)
   */
  getSecretsFilePath(): string {
    return this.secretsFilePath;
  }

  /**
   * Read one secret from one scope: the top-level `secrets` block for the
   * shared scope, the service's section for its own
   */
  async read(key: string, scope: string): Promise<string | null> {
    this.secrets = this.loadSecretsFile();

    const section =
      this.secrets[
        scope === SHARED_SECRETS_SCOPE ? LOCAL_SHARED_SECRETS_SECTION : scope
      ];
    const value = section?.[key];

    return typeof value === 'string' ? value : null;
  }
}
