import type { Permission, UserRole } from '@portal/shared';
import { USER_ROLES } from '@portal/shared/constants';

/**
 * Static least-privilege role map (D3-6). No permission grants access to another user's
 * Job, Input or Result; `USER_MANAGE` is not attached to any HTTP route (CLI only, D3-7).
 */
export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = Object.freeze({
  USER: Object.freeze([]),
  AUDITOR: Object.freeze(['AUDIT_READ'] as const),
  ADMIN: Object.freeze(['AUDIT_READ', 'USER_MANAGE'] as const),
});

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

/** Unknown roles fail closed with no permissions. */
export function permissionsForRole(role: string): readonly Permission[] {
  return isUserRole(role) ? ROLE_PERMISSIONS[role] : [];
}
