import { Router, type Request, type RequestHandler } from 'express';

import { createSuccessResponse } from '@portal/shared';

import { GoneError, HttpError } from '../../http/errors.js';
import type { ActorContext } from '../../shared/authorization.js';
import type { AuditService } from '../audit/audit.service.js';
import { getRequestId, type SessionGuard } from '../identity/session-guard.js';
import { JobNotFoundError } from '../jobs/job.service.js';
import { sendDownload, sendView } from './artifact-delivery.js';
import {
  ArtifactNotFoundError,
  ResultCorruptError,
  ResultNotReadyError,
  ResultUnavailableError,
  type ResultService,
} from './result.service.js';
import { NOOP_RESULTS_LOGGER, resultsLog, type ResultsLogger } from './results-log.js';

const DOWNLOAD_ROUTE = 'GET /api/v1/jobs/:jobId/artifacts/:artifactId/download';
const VIEW_ROUTE = 'GET /api/v1/jobs/:jobId/artifacts/:artifactId/view';

type ResultsRouterOptions = {
  results: ResultService;
  audit: AuditService;
  guard: SessionGuard;
  authenticatedApiLimiter: RequestHandler;
};

/**
 * Results API under `/api/v1/jobs` (design C7). All routes are GET (no CSRF token needed) and
 * use the protected-route chain `requireAuthenticated` → `passwordChangeGate` → limiter. The
 * middleware is per route, so requests for other `/jobs` paths pass through untouched.
 */
export function createResultsRouter({
  audit,
  authenticatedApiLimiter,
  guard,
  results,
}: ResultsRouterOptions): Router {
  const router = Router();
  const protectedRoute = [
    guard.requireAuthenticated,
    guard.passwordChangeGate,
    authenticatedApiLimiter,
  ];

  router.get('/:jobId/result', ...protectedRoute, async (request, response, next) => {
    const jobId = _param(request.params.jobId);

    try {
      const result = await results.getResult(
        _actorOf(request.actor),
        jobId,
        getRequestId(response),
      );
      response.status(200).json(createSuccessResponse(result, getRequestId(response)));
    } catch (error) {
      _logUnavailable(_loggerOf(request), jobId, error);
      next(_toHttpError(error));
    }
  });

  router.get(
    '/:jobId/artifacts/:artifactId/download',
    ...protectedRoute,
    async (request, response, next) => {
      const jobId = _param(request.params.jobId);

      try {
        const actor = _actorOf(request.actor);
        const artifact = await results.getArtifact(
          actor,
          jobId,
          _param(request.params.artifactId),
          getRequestId(response),
          DOWNLOAD_ROUTE,
        );
        await sendDownload(response, artifact, {
          actor,
          audit,
          jobId,
          logger: _loggerOf(request),
          requestId: getRequestId(response),
        });
      } catch (error) {
        next(_toHttpError(error));
      }
    },
  );

  router.get(
    '/:jobId/artifacts/:artifactId/view',
    ...protectedRoute,
    async (request, response, next) => {
      const jobId = _param(request.params.jobId);

      try {
        const artifact = await results.getArtifact(
          _actorOf(request.actor),
          jobId,
          _param(request.params.artifactId),
          getRequestId(response),
          VIEW_ROUTE,
        );
        await sendView(response, artifact, { jobId, logger: _loggerOf(request) });
      } catch (error) {
        next(_toHttpError(error));
      }
    },
  );

  return router;
}

/**
 * The request's pino-http child logger (Foundation redaction applies); no-op when the router is
 * mounted without the request logger.
 */
function _loggerOf(request: Request): ResultsLogger {
  return (request as { log?: ResultsLogger }).log ?? NOOP_RESULTS_LOGGER;
}

/** `Result unavailable` (design Operations C4/C5): `410` missing/invalid and `500` corrupt. */
function _logUnavailable(logger: ResultsLogger, jobId: string, error: unknown): void {
  if (error instanceof ResultUnavailableError) {
    resultsLog.unavailable(logger, { jobId, reason: error.reason });
  } else if (error instanceof ResultCorruptError) {
    resultsLog.unavailable(logger, { jobId, reason: 'INVALID' });
  }
}

/** Route parameter as a string; anything else fails ID validation later (`404`). */
function _param(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

function _actorOf(actor: ActorContext | undefined): ActorContext {
  if (!actor) {
    // requireAuthenticated always sets the actor; reaching here is a wiring bug.
    throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  }

  return actor;
}

/** Error mapping of design C7; messages are fixed and never carry paths or file names. */
function _toHttpError(error: unknown): unknown {
  if (error instanceof JobNotFoundError) {
    return new HttpError(404, 'NOT_FOUND', 'This job is unavailable.');
  }

  if (error instanceof ArtifactNotFoundError) {
    return new HttpError(404, 'NOT_FOUND', 'This file is unavailable.');
  }

  if (error instanceof ResultNotReadyError) {
    return new HttpError(409, 'CONFLICT', error.message, [
      { field: 'status', message: error.jobStatus },
    ]);
  }

  if (error instanceof ResultUnavailableError) {
    return new GoneError();
  }

  if (error instanceof ResultCorruptError) {
    return new HttpError(500, 'INTERNAL_ERROR', 'Unable to complete the request.');
  }

  return error;
}
