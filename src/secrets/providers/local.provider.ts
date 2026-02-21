import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { SecretsProvider } from "../secrets.interface";

const execAsync = promisify(exec);

/**
 * Cache entry with expiration
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Local Secrets Provider
 *
 * Reads secrets from .secrets.local.json file in the project root.
 * Implements caching with 1-minute TTL for performance.
 *
 * File format:
 * {
 *   "auth-service": {
 *     "DATABASE_URL": "postgresql://...",
 *     "AUTH_SECRET": "..."
 *   },
 *   "shared": {
 *     "API_KEY": "...",
 *     "REDIS_PASSWORD": "..."
 *   }
 * }
 */
export class LocalSecretsProvider implements SecretsProvider {
  private secrets: Record<string, Record<string, string>>;
  private secretsFilePath: string;

  // Cache for individual secrets
  private cache = new Map<string, CacheEntry<string>>();

  // Cache for entire service configs
  private serviceCache = new Map<string, CacheEntry<Record<string, string>>>();

  // Cache TTL: 1 minute for local development (60000ms)
  private readonly cacheTtl: number;

  // Current service name for scoped secret access
  private serviceName?: string;

  constructor(
    secretsFilePath: string = ".secrets.local.json",
    cacheTtl: number = 60000 // 1 minute default
  ) {
    // Find the project root (where .secrets.local.json should be)
    this.secretsFilePath = this.findProjectRoot(secretsFilePath);
    this.cacheTtl = cacheTtl;
    this.secrets = this.loadSecretsFile();

    // NODE_ENV hack: Next.js requires this in process.env
    // Check if NODE_ENV exists in secrets and inject into process.env
    const topLevelSecrets = this.secrets['secrets'];
    if (topLevelSecrets && topLevelSecrets['NODE_ENV']) {
      process.env.NODE_ENV = topLevelSecrets['NODE_ENV'];
    }
  }

  /**
   * Set the service name for scoped secret access
   * Used when getting secrets without specifying service name
   *
   * Also injects DATABASE_URL into process.env for Prisma
   * (Prisma schema uses env("DATABASE_URL") before SecretsService is available)
   */
  setServiceName(serviceName: string): void {
    this.serviceName = serviceName;

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
            "Please create .secrets.local.json in your project root.\n" +
            "See docs/secrets-management-strategy.md for details."
        );
      }

      const fileContent = fs.readFileSync(this.secretsFilePath, "utf-8");
      const secrets = JSON.parse(fileContent);

      // Validate structure
      if (typeof secrets !== "object" || secrets === null) {
        throw new Error(
          `Invalid secrets file format. Expected object, got ${typeof secrets}`
        );
      }

      return secrets;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Failed to parse secrets file: ${this.secretsFilePath}\n` +
            `JSON syntax error: ${error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Get all secrets for a service
   *
   * All references are pre-resolved in .secrets.local.json, so we just load the values directly.
   * No need to resolve "secrets" array - it doesn't exist in the final merged file.
   *
   * Note: All secrets are now flat (no nested objects like REDIS)
   */
  async getAll(serviceName: string): Promise<Record<string, string>> {
    const serviceConfig = this.secrets[serviceName];

    if (!serviceConfig) {
      // Return empty object if service has no secrets defined
      // This allows services to optionally have secrets
      return {};
    }

    if (typeof serviceConfig !== "object") {
      throw new Error(
        `Invalid secrets format for "${serviceName}". Expected object, got ${typeof serviceConfig}`
      );
    }

    const result: Record<string, string> = {};

    // Load all service values - all references are already resolved
    for (const [key, value] of Object.entries(serviceConfig)) {
      if (typeof value === "string") {
        result[key] = value;
      } else {
        throw new Error(
          `Invalid value for "${key}" in "${serviceName}". Expected string, got ${typeof value}`
        );
      }
    }

    return result;
  }

  /**
   * Get provider name
   */
  getName(): string {
    return "local";
  }

  /**
   * Get the path to the secrets file (for debugging)
   */
  getSecretsFilePath(): string {
    return this.secretsFilePath;
  }

  /**
   * Get a single secret by key with caching
   * Searches in current service's secrets or top-level secrets
   */
  async get(key: string): Promise<string> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    // Cache miss - reload from file
    this.secrets = this.loadSecretsFile();

    // Look for the secret in service scope first, then top-level
    let value: string | undefined;

    if (this.serviceName) {
      const serviceConfig = this.secrets[this.serviceName];
      if (serviceConfig && typeof serviceConfig[key] === 'string') {
        value = serviceConfig[key];
      }
    }

    // If not found in service scope, check top-level secrets
    if (!value) {
      const topLevelSecrets = this.secrets['secrets'];
      if (topLevelSecrets && typeof topLevelSecrets[key] === 'string') {
        value = topLevelSecrets[key];
      }
    }

    if (!value) {
      throw new Error(
        `Secret "${key}" not found. ` +
        (this.serviceName
          ? `Searched in service "${this.serviceName}" and top-level secrets.`
          : 'Searched in top-level secrets only. Use setServiceName() to search in a specific service.')
      );
    }

    // Cache the value
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.cacheTtl,
    });

    return value;
  }

  /**
   * Set a secret value
   * Updates .secrets.user.json and triggers regeneration
   */
  async set(key: string, value: string): Promise<void> {
    const projectRoot = path.dirname(this.secretsFilePath);
    const userSecretsPath = path.join(projectRoot, '.secrets.user.json');

    // Read .secrets.user.json
    interface UserSecretsFile {
      secrets?: Record<string, string>;
      [serviceName: string]: unknown;
    }

    let userSecrets: UserSecretsFile = {};
    if (fs.existsSync(userSecretsPath)) {
      const content = fs.readFileSync(userSecretsPath, 'utf-8');
      userSecrets = JSON.parse(content) as UserSecretsFile;
    }

    // Ensure secrets section exists
    if (!userSecrets.secrets) {
      userSecrets.secrets = {};
    }

    // Update the key
    userSecrets.secrets[key] = value;

    // Write back to .secrets.user.json
    fs.writeFileSync(
      userSecretsPath,
      JSON.stringify(userSecrets, null, 2),
      'utf-8'
    );

    // Trigger regeneration
    try {
      await execAsync('npx tsdevstack generate-secrets', {
        cwd: projectRoot,
      });
    } catch {
      throw new Error(
        `Failed to regenerate secrets after setting "${key}". ` +
        `Manual regeneration may be required: npx tsdevstack generate-secrets`
      );
    }

    // Clear cache
    this.clearCache();
  }

  /**
   * Delete a secret
   * Removes from .secrets.user.json and triggers regeneration
   */
  async delete(key: string): Promise<void> {
    const projectRoot = path.dirname(this.secretsFilePath);
    const userSecretsPath = path.join(projectRoot, '.secrets.user.json');

    // Read .secrets.user.json
    if (!fs.existsSync(userSecretsPath)) {
      throw new Error(
        `Cannot delete secret: .secrets.user.json not found at ${userSecretsPath}`
      );
    }

    interface UserSecretsFile {
      secrets?: Record<string, string>;
      [serviceName: string]: unknown;
    }

    const content = fs.readFileSync(userSecretsPath, 'utf-8');
    const userSecrets = JSON.parse(content) as UserSecretsFile;

    // Remove the key from secrets section
    if (userSecrets.secrets && userSecrets.secrets[key]) {
      delete userSecrets.secrets[key];

      // Write back
      fs.writeFileSync(
        userSecretsPath,
        JSON.stringify(userSecrets, null, 2),
        'utf-8'
      );

      // Trigger regeneration
      try {
        await execAsync('npx tsdevstack generate-secrets', {
          cwd: projectRoot,
        });
      } catch {
        throw new Error(
          `Failed to regenerate secrets after deleting "${key}". ` +
          `Manual regeneration may be required: npx tsdevstack generate-secrets`
        );
      }

      // Clear cache
      this.clearCache();
    } else {
      throw new Error(`Secret "${key}" not found in .secrets.user.json`);
    }
  }

  /**
   * Clear all cached secrets
   * Forces next get() to reload from file
   */
  clearCache(): void {
    this.cache.clear();
    this.serviceCache.clear();
  }
}
