/**
 * Returns the request path without the query string or fragment.
 *
 * @param request - Request with `url` (Express: path plus query) or `path`
 * @returns The pathname, or an empty string when neither is set
 */
export function getRequestPathname(request: {
  url?: string;
  path?: string;
}): string {
  const raw = request.url || request.path || '';
  const end = raw.search(/[?#]/);
  return end === -1 ? raw : raw.slice(0, end);
}
