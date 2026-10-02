import { timingSafeEqual } from 'node:crypto';

/**
 * Compares a provided secret with the expected one in constant time
 * (for equal lengths).
 *
 * @param provided - Value sent by the caller
 * @param expected - Configured secret
 * @returns true only when both are identical
 */
export function timingSafeStringEqual(
  provided: string,
  expected: string,
): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}
