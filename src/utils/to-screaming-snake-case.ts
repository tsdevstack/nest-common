import { transformKey } from 'deep-case-crafter';

/**
 * Convert a kebab-case name to SCREAMING_SNAKE_CASE, as the CLI names
 * secrets: `auth-service` → `AUTH_SERVICE`.
 *
 * deep-case-crafter converts the name. A name with a capital letter, or one it
 * returns unchanged (`a--b`, `2-api`, `api.service`), gets the plain
 * conversion instead, so every name converts exactly as the CLI does.
 */
export function toScreamingSnakeCase(name: string): string {
  const plain = name.replace(/-/g, '_').toUpperCase();
  if (/[A-Z]/.test(name)) return plain;
  const converted = transformKey(name, { targetCase: 'constant' });
  return converted === name ? plain : converted;
}
