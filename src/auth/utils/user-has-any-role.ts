import type { KongUser } from '../auth-user.interface';
import {
  CUSTOM_ROLES_CLAIM,
  LEGACY_ROLE_CLAIM,
  SYSTEM_ROLE_CLAIM,
} from '../roles.constants';

/**
 * Whether a user holds at least one of the required roles.
 *
 * Checks the system role (`systemRole`, falling back to the older `role`
 * claim) and the custom roles (`roles`, a list of strings).
 *
 * @param user - User from `X-Userinfo`, or undefined
 * @param requiredRoles - Roles of which the user needs at least one
 * @returns true when the user holds one of them
 */
export function userHasAnyRole(
  user: KongUser | undefined,
  requiredRoles: readonly string[],
): boolean {
  if (!user) {
    return false;
  }

  const held = new Set<string>();

  const systemRole = user[SYSTEM_ROLE_CLAIM] ?? user[LEGACY_ROLE_CLAIM];
  if (typeof systemRole === 'string' && systemRole !== '') {
    held.add(systemRole);
  }

  const customRoles = user[CUSTOM_ROLES_CLAIM];
  if (Array.isArray(customRoles)) {
    for (const role of customRoles) {
      if (typeof role === 'string' && role !== '') {
        held.add(role);
      }
    }
  }

  return requiredRoles.some((role) => held.has(role));
}
