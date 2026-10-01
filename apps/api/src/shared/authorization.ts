export type ActorContext = {
  userId: string;
  role: 'ADMIN' | 'USER';
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
