import { Router, type RequestHandler } from 'express';

import {
  createSuccessResponse,
  idempotencyKeySchema,
  jobListQuerySchema,
  jobSubmitRequestSchema,
} from '@portal/shared';

import { HttpError } from '../../http/errors.js';
import type { ActorContext } from '../../shared/authorization.js';
import { validationError } from '../identity/identity.routes.js';
import { getRequestId, type SessionGuard } from '../identity/session-guard.js';
import {
  InputValidationError,
  JobNotFoundError,
  ServiceUnavailableError,
  type JobService,
} from './job.service.js';
import { SAMPLE_INPUT } from './sample-input.js';

type JobsRouterOptions = {
  jobs: JobService;
  guard: SessionGuard;
  authenticatedApiLimiter: RequestHandler;
  submitLimiter: RequestHandler;
};

/** Routes under `/api/v1/jobs` (CSRF protection is applied by the app before this router). */
export function createJobsRouter({
  authenticatedApiLimiter,
  guard,
  jobs,
  submitLimiter,
}: JobsRouterOptions): Router {
  const router = Router();

  router.use(guard.requireAuthenticated, guard.passwordChangeGate, authenticatedApiLimiter);

  router.get('/sample-input', (_request, response) => {
    response.status(200).json(createSuccessResponse(SAMPLE_INPUT, getRequestId(response)));
  });

  router.post('/', submitLimiter, async (request, response, next) => {
    try {
      const key = idempotencyKeySchema.safeParse(request.get('Idempotency-Key'));

      if (!key.success) {
        throw new HttpError(400, 'VALIDATION_FAILED', 'Request validation failed.', [
          { field: 'Idempotency-Key', message: 'Send a UUID Idempotency-Key header.' },
        ]);
      }

      const body = jobSubmitRequestSchema.safeParse(request.body ?? {});

      if (!body.success) {
        throw validationError(body.error);
      }

      const result = await jobs.submit({
        actor: actorOf(request.actor),
        file: body.data.file,
        idempotencyKey: key.data,
        parameters: body.data.parameters,
        requestId: getRequestId(response),
      });

      response
        .status(result.replayed ? 200 : 201)
        .json(
          createSuccessResponse(
            { job: result.job, statusUrl: `/jobs/${result.job.id}` },
            getRequestId(response),
          ),
        );
    } catch (error) {
      next(toHttpError(error));
    }
  });

  router.get('/', async (request, response, next) => {
    try {
      const query = jobListQuerySchema.safeParse(request.query);

      if (!query.success) {
        throw validationError(query.error);
      }

      const data = await jobs.list(actorOf(request.actor), query.data.page, query.data.limit);
      response.status(200).json(createSuccessResponse(data, getRequestId(response)));
    } catch (error) {
      next(toHttpError(error));
    }
  });

  router.get('/:jobId', async (request, response, next) => {
    try {
      const job = await jobs.get(
        actorOf(request.actor),
        request.params.jobId,
        getRequestId(response),
        'GET /api/v1/jobs/:jobId',
      );
      response.status(200).json(createSuccessResponse(job, getRequestId(response)));
    } catch (error) {
      next(toHttpError(error));
    }
  });

  router.delete('/:jobId', async (request, response, next) => {
    try {
      await jobs.remove({
        actor: actorOf(request.actor),
        jobId: request.params.jobId,
        reason: 'OWNER_REQUEST',
        requestId: getRequestId(response),
        route: 'DELETE /api/v1/jobs/:jobId',
      });
      response.status(204).end();
    } catch (error) {
      next(toHttpError(error));
    }
  });

  return router;
}

function actorOf(actor: ActorContext | undefined): ActorContext {
  if (!actor) {
    // requireAuthenticated always sets the actor; reaching here is a wiring bug.
    throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  }

  return actor;
}

function toHttpError(error: unknown): unknown {
  if (error instanceof JobNotFoundError) {
    return new HttpError(404, 'NOT_FOUND', 'This job is unavailable.');
  }

  if (error instanceof ServiceUnavailableError) {
    return new HttpError(503, 'SERVICE_UNAVAILABLE', error.message);
  }

  if (error instanceof InputValidationError) {
    return new HttpError(
      400,
      'VALIDATION_FAILED',
      'Request validation failed.',
      error.issues.map((issue) => ({
        field: issue.line ? `file.line ${issue.line}` : 'file',
        message: issue.line ? `Line ${issue.line}: ${issue.message}` : issue.message,
      })),
    );
  }

  return error;
}
