import { transformKey } from 'deep-case-crafter';

/**
 * Convert a name to snake_case: hyphens become underscores
 * (`auth-service` → `auth_service`).
 *
 * deep-case-crafter converts the name. A name with a capital letter, or one it
 * returns unchanged (`a--b`, `2-api`, `my.app`), gets the plain conversion
 * instead, so every name converts exactly as before.
 */
export function toSnakeCase(name: string): string {
  const plain = name.replace(/-/g, '_');
  if (/[A-Z]/.test(name)) return plain;
  const converted = transformKey(name, { targetCase: 'snake' });
  return converted === name ? plain : converted;
}
