import * as fs from 'fs';
import * as path from 'path';

/**
 * Framework service configuration
 * Loaded from .tsdevstack/config.json
 */
export interface FrameworkServiceConfig {
  serviceName: string;
  type: string;
  port: number;
  globalPrefix: string;
  hasDatabase: boolean;
  databaseType?: string;
}

/**
 * Framework configuration structure
 */
interface FrameworkConfig {
  project: {
    name: string;
    version: string;
  };
  cloud: {
    provider: string;
  };
  services: Array<{
    name: string;
    type: string;
    port: number;
    globalPrefix: string;
    hasDatabase: boolean;
    databaseType?: string;
  }>;
}

/**
 * Load framework configuration for a specific service
 *
 * This function:
 * 1. Finds .tsdevstack/config.json by walking up the directory tree
 * 2. Parses and validates the JSON
 * 3. Finds the service by name
 * 4. Returns typed configuration object
 *
 * @param serviceName - The name of the service (e.g., 'auth-service')
 * @returns Service configuration from framework config
 * @throws Error if config file not found or service not found
 *
 * @example
 * ```typescript
 * const config = loadFrameworkConfig('auth-service');
 * // Returns: { serviceName: 'auth-service', port: 3001, ... }
 * ```
 */
export function loadFrameworkConfig(
  serviceName: string,
): FrameworkServiceConfig {
  // Find config file
  const configPath = findFrameworkConfigFile();

  if (!configPath) {
    throw new Error(
      'Framework configuration not found.\n' +
        'Expected .tsdevstack/config.json in project root.\n' +
        'Please ensure the file exists.',
    );
  }

  // Read and parse config
  let frameworkConfig: FrameworkConfig;
  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    frameworkConfig = JSON.parse(configContent);
  } catch (error) {
    throw new Error(
      `Failed to read framework configuration: ${configPath}\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Validate config structure
  if (!frameworkConfig.services || !Array.isArray(frameworkConfig.services)) {
    throw new Error(
      'Invalid framework configuration.\n' +
        'Expected "services" array in .tsdevstack/config.json',
    );
  }

  // Find service
  const serviceConfig = frameworkConfig.services.find(
    (s) => s.name === serviceName,
  );

  if (!serviceConfig) {
    const availableServices = frameworkConfig.services
      .map((s) => s.name)
      .join(', ');
    throw new Error(
      `Service "${serviceName}" not found in framework configuration.\n` +
        `Available services: ${availableServices}\n` +
        `Please add the service to .tsdevstack/config.json`,
    );
  }

  // Return typed configuration
  return {
    serviceName: serviceConfig.name,
    type: serviceConfig.type,
    port: serviceConfig.port,
    globalPrefix: serviceConfig.globalPrefix,
    hasDatabase: serviceConfig.hasDatabase,
    databaseType: serviceConfig.databaseType,
  };
}

/**
 * Find .tsdevstack/config.json by walking up the directory tree
 *
 * @returns Path to config file or null if not found
 */
function findFrameworkConfigFile(): string | null {
  let currentDir = process.cwd();
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const configPath = path.join(currentDir, '.tsdevstack', 'config.json');

    if (fs.existsSync(configPath)) {
      return configPath;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }

    currentDir = parentDir;
    depth++;
  }

  return null;
}