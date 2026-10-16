import type { Permission, UserRole } from '@portal/shared';

export type ActorContext = {
  userId: string;
  role: UserRole;
  /** Role permissions from the static map; they never grant access to owned resources. */
  permissions?: readonly Permission[];
  /** Explicit per-resource grants (none are issued in the MVP). */
  explicitPermissions?: readonly string[];
};

export class AuthorizationError extends Error {
  public constructor() {
    super('The requested resource is unavailable.');
    this.name = 'AuthorizationError';
  }
}

export function canAccessOwnedResource(
  actor: ActorContext,
  ownerId: string,
  explicitPermission?: string,
): boolean {
  if (actor.userId === ownerId) {
    return true;
  }

  return Boolean(explicitPermission && actor.explicitPermissions?.includes(explicitPermission));
}

export function assertOwnedResourceAccess(
  actor: ActorContext,
  ownerId: string,
  explicitPermission?: string,
): void {
  if (!canAccessOwnedResource(actor, ownerId, explicitPermission)) {
    throw new AuthorizationError();
  }
}
