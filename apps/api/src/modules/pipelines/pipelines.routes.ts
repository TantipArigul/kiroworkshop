import { Router, type Request, type RequestHandler, type Response } from 'express';

import { createSuccessResponse, idempotencyKeySchema } from '@portal/shared';

import { HttpError } from '../../http/errors.js';
import type { ActorContext } from '../../shared/authorization.js';
import { getRequestId, type SessionGuard } from '../identity/session-guard.js';
import {
  PipelineNotFoundError,
  PipelineUnavailableError,
  RunValidationError,
  type PipelineRunService,
} from './pipeline-run.service.js';
import { UploadRejectedError } from './run-upload.js';

/** Bodies up to this size are drained so the client still reads the error response. */
const DRAIN_MAX_BYTES = 8 * 1_048_576;

type PipelinesRouterOptions = {
  pipelines: PipelineRunService;
  guard: SessionGuard;
  authenticatedApiLimiter: RequestHandler;
  submitLimiter: RequestHandler;
};

/** Routes under `/api/v1/pipelines` (CSRF protection is applied by the app before this router). */
export function createPipelinesRouter({
  authenticatedApiLimiter,
  guard,
  pipelines,
  submitLimiter,
}: PipelinesRouterOptions): Router {
  const router = Router();

  router.use(guard.requireAuthenticated, guard.passwordChangeGate, authenticatedApiLimiter);

  router.get('/', (_request, response) => {
    response
      .status(200)
      .json(createSuccessResponse({ items: pipelines.listPipelines() }, getRequestId(response)));
  });

  router.get('/:pipelineId', (request, response, next) => {
    try {
      response
        .status(200)
        .json(
          createSuccessResponse(
            pipelines.getPipeline(request.params.pipelineId),
            getRequestId(response),
          ),
        );
    } catch (error) {
      next(toHttpError(error));
    }
  });

  router.post('/:pipelineId/runs', submitLimiter, async (request, response, next) => {
    try {
      const key = idempotencyKeySchema.safeParse(request.get('Idempotency-Key'));

      if (!key.success) {
        throw new HttpError(400, 'VALIDATION_FAILED', 'Request validation failed.', [
          { field: 'Idempotency-Key', message: 'Send a UUID Idempotency-Key header.' },
        ]);
      }

      const result = await pipelines.launch({
        actor: actorOf(request.actor),
        idempotencyKey: key.data,
        pipelineId: String(request.params.pipelineId ?? ''),
        request,
        requestId: getRequestId(response),
      });

      _discardUnreadBody(request, response);
      response
        .status(result.replayed ? 200 : 201)
        .json(
          createSuccessResponse(
            { job: result.job, statusUrl: `/jobs/${result.job.id}` },
            getRequestId(response),
          ),
        );
    } catch (error) {
      _discardUnreadBody(request, response);
      next(toHttpError(error));
    }
  });

  return router;
}

/**
 * The launch body is read only after the replay/availability checks; when a response is sent
 * before the body was consumed, small bodies are drained and the connection is closed so no
 * more upload bytes are accepted.
 */
function _discardUnreadBody(request: Request, response: Response): void {
  if (request.complete || request.readableEnded) {
    return;
  }

  response.setHeader('Connection', 'close');
  const length = Number(request.get('Content-Length') ?? Number.NaN);

  if (Number.isFinite(length) && length <= DRAIN_MAX_BYTES) {
    request.resume();
  }
}

function actorOf(actor: ActorContext | undefined): ActorContext {
  if (!actor) {
    // requireAuthenticated always sets the actor; reaching here is a wiring bug.
    throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  }

  return actor;
}

function toHttpError(error: unknown): unknown {
  if (error instanceof PipelineNotFoundError) {
    return new HttpError(404, 'NOT_FOUND', error.message);
  }

  if (error instanceof PipelineUnavailableError) {
    return new HttpError(503, 'SERVICE_UNAVAILABLE', error.message);
  }

  if (error instanceof UploadRejectedError) {
    return new HttpError(400, 'VALIDATION_FAILED', 'Request validation failed.', error.issues);
  }

  if (error instanceof RunValidationError) {
    return new HttpError(
      400,
      'VALIDATION_FAILED',
      'Request validation failed.',
      error.issues.map((issue) => ({ field: issue.field, message: issue.message })),
    );
  }

  return error;
}
