import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import { createSuccessResponse } from '@portal/shared';

import type { AppConfig } from '../config/index.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaSessionStore } from '../infrastructure/prisma-session-store.js';
import { createLogger, createRequestLogger } from '../shared/logger.js';
import { createErrorResponse, HttpError } from './errors.js';
import {
  CorsOriginError,
  createOriginGuardMiddleware,
  createRateLimiters,
  createSecurityHeadersMiddleware,
  createSessionMiddleware,
  csrfProtection,
  generateCsrfToken,
  RateLimitError,
} from './security.js';

export type ApiRuntimeState = {
  draining: boolean;
  startedAt: number;
};

export function createApiApp(
  config: AppConfig,
  prisma: PrismaClient,
  runtimeState: ApiRuntimeState = { draining: false, startedAt: Date.now() },
): Express {
  const app = express();
  const logger = createLogger(config);
  const sessionStore = new PrismaSessionStore(prisma);
  const rateLimiters = createRateLimiters(config);

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(createSecurityHeadersMiddleware());
  app.use(createRequestLogger(logger));
  app.use(createRequestIdMiddleware());
  app.use(createOriginGuardMiddleware(config));
  app.use(express.json({ limit: '1mb' }));
  app.use(createSessionMiddleware(config, sessionStore));

  app.get('/health', (_request, response) => {
    response.status(200).json(
      createSuccessResponse(
        {
          status: 'ok',
          uptimeSeconds: Math.floor((Date.now() - runtimeState.startedAt) / 1000),
          version: '0.1.0',
        },
        getRequestId(response),
      ),
    );
  });

  app.get('/health/ready', async (_request, response) => {
    if (runtimeState.draining) {
      response
        .status(503)
        .json(
          createSuccessResponse(
            { checks: { database: 'ok' }, status: 'not_ready' },
            getRequestId(response),
          ),
        );
      return;
    }

    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      response
        .status(200)
        .json(
          createSuccessResponse(
            { checks: { database: 'ok' }, status: 'ready' },
            getRequestId(response),
          ),
        );
    } catch {
      response
        .status(503)
        .json(
          createSuccessResponse(
            { checks: { database: 'failed' }, status: 'not_ready' },
            getRequestId(response),
          ),
        );
    }
  });

  app.get('/api/v1/auth/csrf-token', (request, response) => {
    response
      .status(200)
      .json(
        createSuccessResponse({ csrfToken: generateCsrfToken(request) }, getRequestId(response)),
      );
  });

  app.use('/api/v1', csrfProtection);
  app.post('/api/v1/auth/login', rateLimiters.login, (_request, _response, next) => {
    next(new HttpError(501, 'NOT_IMPLEMENTED', 'Authentication is not available yet.'));
  });
  app.post('/api/v1/auth/logout', (request, response, next) => {
    request.session.destroy((error) => {
      if (error) {
        next(error);
        return;
      }

      response.status(204).end();
    });
  });
  app.get('/api/v1/auth/me', async (request, response, next) => {
    const userId = request.session.userId;

    if (!userId) {
      next(new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.'));
      return;
    }

    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user || user.disabledAt) {
        next(new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.'));
        return;
      }

      response
        .status(200)
        .json(
          createSuccessResponse(
            { id: user.id, role: user.role, username: user.username },
            getRequestId(response),
          ),
        );
    } catch (error) {
      next(error);
    }
  });

  app.use(createErrorMiddleware());

  return app;
}

function createRequestIdMiddleware(): (
  request: Request,
  response: Response,
  next: NextFunction,
) => void {
  return (request, response, next) => {
    const incomingRequestId = request.headers['x-request-id'];
    const requestId =
      typeof incomingRequestId === 'string' ? incomingRequestId : crypto.randomUUID();

    response.locals.requestId = requestId;
    response.setHeader('X-Request-ID', requestId);
    next();
  };
}

function createErrorMiddleware(): (
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction,
) => void {
  return (error, _request, response, next) => {
    void next;
    const requestId = getRequestId(response);

    if (error instanceof HttpError) {
      response.status(error.status).json(createErrorResponse(error.code, error.message, requestId));
      return;
    }

    if (error instanceof CorsOriginError) {
      response
        .status(403)
        .json(
          createErrorResponse('AUTHORIZATION_DENIED', 'Request origin is not allowed.', requestId),
        );
      return;
    }

    if (error instanceof RateLimitError) {
      response
        .status(429)
        .json(
          createErrorResponse(
            'RATE_LIMITED',
            'Too many requests. Please try again later.',
            requestId,
          ),
        );
      return;
    }

    if (isCsrfError(error)) {
      response
        .status(403)
        .json(createErrorResponse('CSRF_INVALID', 'Request validation failed.', requestId));
      return;
    }

    response
      .status(500)
      .json(createErrorResponse('INTERNAL_ERROR', 'Unable to complete the request.', requestId));
  };
}

function getRequestId(response: Response): string {
  return String(response.locals.requestId ?? crypto.randomUUID());
}

function isCsrfError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EBADCSRFTOKEN'
  );
}
