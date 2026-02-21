/**
 * Parses header value to appropriate JavaScript type.
 *
 * Kong forwards all JWT claims as strings. This function intelligently
 * parses them back to their original types:
 * - Arrays: "USER,ADMIN" → ["USER", "ADMIN"]
 * - Numbers: "123" → 123
 * - Booleans: "true" → true, "false" → false
 * - Strings: everything else
 *
 * @param value - String value from header
 * @returns Parsed value in appropriate type
 *
 * @example Arrays
 * ```typescript
 * parseHeaderValue('USER,ADMIN')     // ['USER', 'ADMIN']
 * parseHeaderValue('read, write, delete') // ['read', 'write', 'delete']
 * ```
 *
 * @example Numbers
 * ```typescript
 * parseHeaderValue('123')    // 123
 * parseHeaderValue('0')      // 0
 * parseHeaderValue('456789') // 456789
 * ```
 *
 * @example Booleans
 * ```typescript
 * parseHeaderValue('true')   // true
 * parseHeaderValue('false')  // false
 * ```
 *
 * @example Strings
 * ```typescript
 * parseHeaderValue('john@example.com') // 'john@example.com'
 * parseHeaderValue('Hello World')      // 'Hello World'
 * parseHeaderValue('123abc')           // '123abc' (not pure number)
 * ```
 */
export function parseHeaderValue(value: string): string | string[] | number | boolean {
  // Parse arrays (comma-separated values)
  if (value.includes(',')) {
    return value.split(',').map((v) => v.trim());
  }

  // Parse numbers (only if entire string is digits)
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10);
  }

  // Parse booleans
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Return as string
  return value;
}