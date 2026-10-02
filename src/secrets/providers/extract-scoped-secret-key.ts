/**
 * Return the key of a cloud secret name that belongs to one of the given scope
 * prefixes, or null when it belongs to none of them.
 *
 * Names are `${projectName}-${scope}-${KEY}`, so a scope prefix is
 * `${projectName}-${scope}-`. One service's prefix can also prefix another
 * service's names (`tsdevstack-auth-` and `tsdevstack-auth-service-…`), so the
 * rest of the name only counts as a key when it matches `keyPattern`. Keys
 * start with an uppercase letter and service names are lowercase, which
 * rejects `service-DATABASE_URL`.
 *
 * Input: "tsdevstack-auth-service-DATABASE_URL", ["tsdevstack-shared-", "tsdevstack-auth-service-"]
 *   → "DATABASE_URL"
 * Input: "tsdevstack-offers-service-DATABASE_URL", same prefixes → null
 */
export function extractScopedSecretKey(
  secretName: string,
  scopePrefixes: readonly string[],
  keyPattern: RegExp,
): string | null {
  for (const prefix of scopePrefixes) {
    if (!secretName.startsWith(prefix)) {
      continue;
    }

    const key = secretName.substring(prefix.length);
    if (keyPattern.test(key)) {
      return key;
    }
  }

  return null;
}
