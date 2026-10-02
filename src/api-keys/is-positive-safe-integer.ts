/**
 * Whether a value is an integer from 1 to `Number.MAX_SAFE_INTEGER`.
 */
export function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
