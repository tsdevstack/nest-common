/**
 * Reads one request header as a string.
 *
 * Node joins repeated custom headers into one comma-separated string; an
 * array only appears for a few standard headers. Arrays are joined the same
 * way, so a repeated header never matches a single expected value.
 *
 * @param headers - Request headers (lowercase names, as Node exposes them)
 * @param name - Lowercase header name
 * @returns The header value, or undefined when absent
 */
export function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return value;
}
