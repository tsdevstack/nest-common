import * as fs from 'fs';
import * as path from 'path';

export interface PackageJson {
  name: string;
  version?: string;
  description?: string;
  author?: string | { name: string };
}

/**
 * Read package.json from current working directory
 * Used by runtime code to get service metadata
 *
 * Note: This function does NOT validate the service name.
 * Validation happens at dev/build time via CLI.
 */
export function readPackageJson(): PackageJson {
  const packageJsonPath = path.join(process.cwd(), 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(
      `package.json not found at ${packageJsonPath}\n` +
        `Ensure the service is started from its directory (e.g., apps/auth-service/)`,
    );
  }

  try {
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Failed to parse package.json: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
