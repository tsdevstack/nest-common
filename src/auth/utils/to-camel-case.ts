/**
 * Converts kebab-case to camelCase.
 *
 * Used to transform Kong header names (which use kebab-case) to
 * JavaScript property names (which use camelCase).
 *
 * @param str - Kebab-case string (e.g., "tenant-id")
 * @returns CamelCase string (e.g., "tenantId")
 *
 * @example
 * ```typescript
 * toCamelCase('tenant-id')      // 'tenantId'
 * toCamelCase('is-verified')    // 'isVerified'
 * toCamelCase('email')          // 'email'
 * toCamelCase('user-role-name') // 'userRoleName'
 * ```
 */
export function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}