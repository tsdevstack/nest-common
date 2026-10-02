/**
 * Metadata key for the @Roles() decorator.
 */
export const ROLES_KEY = 'roles';

/**
 * User claims read by `RolesGuard`: the framework-owned system role, the
 * previous name of that claim (older auth-services), and the custom roles.
 */
export const SYSTEM_ROLE_CLAIM = 'systemRole';
export const LEGACY_ROLE_CLAIM = 'role';
export const CUSTOM_ROLES_CLAIM = 'roles';
