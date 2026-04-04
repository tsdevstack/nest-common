/**
 * Convert service name to title case
 * Example: "auth-service" -> "Auth Service"
 */
export function titleCase(str: string): string {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
