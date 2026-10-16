import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { Permission } from '@portal/shared';

import type { AppConfig } from '../../config/index.js';
import { HttpError } from '../../http/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import { toAuthenticatedUser, type IdentityService } from './identity.service.js';

type SessionGuardOptions = {
  identity: Pick<IdentityService, 'findUserById'>;
  audit: AuditService;
  config: Pick<AppConfig, 'sessionAbsoluteTimeoutMs'>;
  clock?: () => number;
};

export type SessionGuard = ReturnType<typeof createSessionGuard>;

export function authenticationRequired(): HttpError {
  return new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
}

export function getRequestId(response: Response): string {
  return String(response.locals.requestId ?? crypto.randomUUID());
}

/**
 * Middleware every protected route uses (unit contract for Jobs and Results):
 * `requireAuthenticated` → `passwordChangeGate` → optional `requirePermission(...)`.
 */
export function createSessionGuard({
  audit,
  clock = Date.now,
  config,
  identity,
}: SessionGuardOptions) {
  const requireAuthenticated: RequestHandler = async (request, _response, next) => {
    const { authenticatedAt, userId } = request.session;

    if (!userId || !authenticatedAt) {
      next(authenticationRequired());
      return;
    }

    try {
      if (clock() - authenticatedAt > config.sessionAbsoluteTimeoutMs) {
        await destroySession(request);
        next(authenticationRequired());
        return;
      }

      // Reload on every request so disabled accounts and role changes apply immediately.
      const user = await identity.findUserById(userId);

      if (!user || user.disabledAt) {
        await destroySession(request);
        next(authenticationRequired());
        return;
      }

      const currentUser = toAuthenticatedUser(user);
      request.currentUser = currentUser;
      request.actor = {
        permissions: currentUser.permissions,
        role: currentUser.role,
        userId: currentUser.id,
      };
      next();
    } catch (error) {
      next(error);
    }
  };

  const passwordChangeGate: RequestHandler = (request, _response, next) => {
    if (request.currentUser?.passwordChangeRequired) {
      next(new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password to continue.'));
      return;
    }

    next();
  };

  function requirePermission(permission: Permission): RequestHandler {
    return (request: Request, response: Response, next: NextFunction) => {
      if (request.actor?.permissions?.includes(permission)) {
        next();
        return;
      }

      void audit.recordSafely({
        actorId: request.actor?.userId ?? null,
        eventType: 'AUTHORIZATION_DENIED',
        metadata: { method: request.method, permission, route: request.originalUrl.split('?')[0] },
        outcome: 'DENIED',
        requestId: getRequestId(response),
        resourceId: null,
        resourceType: 'AUDIT',
      });
      next(new HttpError(403, 'AUTHORIZATION_DENIED', 'You do not have access to this resource.'));
    };
  }

  return { passwordChangeGate, requireAuthenticated, requirePermission };
}

export function destroySession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}
