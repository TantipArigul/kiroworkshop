import { Router, type Request, type RequestHandler } from 'express';
import type { ZodError } from 'zod';

import {
  changePasswordRequestSchema,
  createSuccessResponse,
  loginRequestSchema,
} from '@portal/shared';

import { HttpError, type ApiErrorDetail } from '../../http/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import {
  AuthenticationFailedError,
  PasswordPolicyError,
  toAuthenticatedUser,
  type IdentityService,
} from './identity.service.js';
import { PASSWORD_VIOLATION_MESSAGES } from './password-policy.js';
import { destroySession, getRequestId, type SessionGuard } from './session-guard.js';

type IdentityRouterOptions = {
  identity: IdentityService;
  audit: AuditService;
  guard: SessionGuard;
  loginRateLimiter: RequestHandler;
  generateCsrfToken: (request: Request, overwrite?: boolean) => string;
  sessionCookieName: string;
};

/** Routes under `/api/v1/auth` (CSRF protection is applied by the app before this router). */
export function createIdentityRouter(options: IdentityRouterOptions): Router {
  const { audit, guard, identity } = options;
  const router = Router();

  router.post('/login', options.loginRateLimiter, async (request, response, next) => {
    try {
      const input = loginRequestSchema.safeParse(request.body ?? {});

      if (!input.success) {
        throw validationError(input.error);
      }

      const user = await identity.authenticate(
        input.data.email,
        input.data.password,
        getRequestId(response),
      );

      // New session ID on every login prevents session fixation (D3-5).
      await regenerateSession(request);
      request.session.userId = user.id;
      request.session.authenticatedAt = Date.now();
      const csrfToken = options.generateCsrfToken(request, true);
      await saveSession(request);

      response
        .status(200)
        .json(
          createSuccessResponse(
            { csrfToken, user: toAuthenticatedUser(user) },
            getRequestId(response),
          ),
        );
    } catch (error) {
      next(
        error instanceof AuthenticationFailedError
          ? new HttpError(401, 'AUTHENTICATION_FAILED', error.message)
          : error,
      );
    }
  });

  router.post('/logout', guard.requireAuthenticated, async (request, response, next) => {
    try {
      await audit.recordSafely({
        actorId: request.actor?.userId ?? null,
        eventType: 'LOGOUT',
        outcome: 'SUCCESS',
        requestId: getRequestId(response),
        resourceId: null,
        resourceType: 'SESSION',
      });
      await destroySession(request);
      response.clearCookie(options.sessionCookieName);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', guard.requireAuthenticated, (request, response) => {
    response.status(200).json(createSuccessResponse(request.currentUser, getRequestId(response)));
  });

  router.post('/password', guard.requireAuthenticated, async (request, response, next) => {
    try {
      const input = changePasswordRequestSchema.safeParse(request.body ?? {});

      if (!input.success) {
        throw validationError(input.error);
      }

      await identity.changePassword({
        currentPassword: input.data.currentPassword,
        currentSessionId: request.sessionID,
        newPassword: input.data.newPassword,
        requestId: getRequestId(response),
        userId: request.actor?.userId ?? '',
      });
      response.status(204).end();
    } catch (error) {
      if (error instanceof AuthenticationFailedError) {
        next(new HttpError(401, 'AUTHENTICATION_FAILED', 'The current password is incorrect.'));
        return;
      }

      if (error instanceof PasswordPolicyError) {
        next(
          new HttpError(
            400,
            'VALIDATION_FAILED',
            'Choose a different password.',
            error.violations.map((violation) => ({
              field: 'newPassword',
              message: PASSWORD_VIOLATION_MESSAGES[violation],
            })),
          ),
        );
        return;
      }

      next(error);
    }
  });

  return router;
}

/** Field-level validation errors that never echo the submitted values. */
export function validationError(error: ZodError): HttpError {
  const details: ApiErrorDetail[] = error.issues.slice(0, 20).map((issue) => ({
    field: issue.path.join('.') || undefined,
    message: issue.code === 'unrecognized_keys' ? 'Unexpected field.' : 'Invalid value.',
  }));

  return new HttpError(400, 'VALIDATION_FAILED', 'Request validation failed.', details);
}

function regenerateSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()));
  });
}
