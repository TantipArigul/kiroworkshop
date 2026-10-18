import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import { createSuccessResponse } from '@portal/shared';

import type { NextflowConfig } from '../config/config.js';
import type { AppConfig } from '../config/index.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaSessionStore } from '../infrastructure/prisma-session-store.js';
import { createAuditRouter } from '../modules/audit/audit.routes.js';
import { createAuditService } from '../modules/audit/audit.service.js';
import { createIdentityRouter } from '../modules/identity/identity.routes.js';
import { createIdentityService } from '../modules/identity/identity.service.js';
import { createSessionGuard } from '../modules/identity/session-guard.js';
import type { JobCompletionHandler } from '../modules/jobs/completion.js';
import { createExecutorDirectory } from '../modules/jobs/executor.js';
import { createJobStorage } from '../modules/jobs/job-storage.js';
import { createJobWorker, type JobWorker } from '../modules/jobs/job-worker.js';
import { createJobService } from '../modules/jobs/job.service.js';
import { createJobsRouter } from '../modules/jobs/jobs.routes.js';
import { createRetentionSweeper } from '../modules/jobs/retention.js';
import { createSimulatedAdapter } from '../modules/jobs/simulated-adapter.js';
import {
  createNextflowAdapter,
  resolveNextflowConfig,
} from '../modules/pipelines/nextflow-adapter.js';
import {
  createPipelineRunService,
  recordOutputs,
} from '../modules/pipelines/pipeline-run.service.js';
import { createPipelinesRouter } from '../modules/pipelines/pipelines.routes.js';
import { pipelineIdsForExecutor } from '../modules/pipelines/registry.js';
import type { RunUploadLimits } from '../modules/pipelines/run-upload.js';
import { createResultService } from '../modules/results/result.service.js';
import { createResultsRouter } from '../modules/results/results.routes.js';
import { createSmartCheckupResultBuilder } from '../modules/results/smart-checkup-result.js';
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
  SESSION_COOKIE_NAME,
} from './security.js';

export type ApiRuntimeState = {
  draining: boolean;
  startedAt: number;
};

export type ApiAppOptions = {
  /** Replaces the default Smart Checkup result builder (Results & Guidance C3); tests only. */
  completionHandler?: JobCompletionHandler;
  /** Test hook: overrides executor readiness when the worker loop is not started. */
  isExecutorReady?: () => boolean;
  /** Test hook: smaller upload limits than the 1 GiB / 10 FASTQ / 64 KB requirement values. */
  runUploadLimits?: RunUploadLimits;
};

/** Core settings plus the Nextflow settings (absent ones fall back to the config defaults). */
export type ApiAppConfig = AppConfig & Partial<NextflowConfig>;

export function createApiApp(
  config: ApiAppConfig,
  prisma: PrismaClient,
  runtimeState: ApiRuntimeState = { draining: false, startedAt: Date.now() },
  options: ApiAppOptions = {},
): Express {
  const app = express();
  const logger = createLogger(config);
  const sessionStore = new PrismaSessionStore(prisma);
  const rateLimiters = createRateLimiters(config);
  const audit = createAuditService(prisma, logger);
  const identity = createIdentityService({ audit, config, prisma });
  const guard = createSessionGuard({ audit, config, identity });
  const storage = createJobStorage(config.storageRoot);
  const simulatedAdapter = createSimulatedAdapter({
    completionHandler: options.completionHandler ?? createSmartCheckupResultBuilder(),
    config,
    logger,
    prisma,
    storage,
  });
  const nextflowConfig = resolveNextflowConfig(config);
  const nextflowAdapter = createNextflowAdapter({
    config: nextflowConfig,
    logger,
    prisma,
    recordOutputs: (tx, input) => recordOutputs(tx, { ...input, storage }),
    storage,
  });
  const executors = createExecutorDirectory([
    { adapter: simulatedAdapter, pipelineIds: pipelineIdsForExecutor('simulated') },
    { adapter: nextflowAdapter, pipelineIds: pipelineIdsForExecutor('nextflow') },
  ]);
  const jobs = createJobService({
    audit,
    config,
    executors,
    isExecutorReady: () => executorReady(),
    logger,
    prisma,
    storage,
  });
  const pipelines = createPipelineRunService({
    audit,
    availability: (pipelineId) => {
      if (!executorReady()) {
        return { available: false, unavailableReason: null };
      }

      const adapter = executors.adapterFor(pipelineId);

      if (adapter === nextflowAdapter) {
        const state = nextflowAdapter.readiness(pipelineId);
        return { available: state.ready, unavailableReason: state.reason };
      }

      return { available: adapter?.isReady() ?? false, unavailableReason: null };
    },
    jobs,
    logger,
    prisma,
    storage,
    uploadLimits: options.runUploadLimits,
  });
  const results = createResultService({ jobs, pipelines, prisma, storage });
  const sweepExpiredJobs = createRetentionSweeper({ audit, jobs, logger, prisma, storage });
  const worker = createJobWorker({
    config,
    executors,
    jobs,
    logger,
    prisma,
    storage,
    sweep: async () => {
      const result = await sweepExpiredJobs();

      if (result.deleted + result.failed + result.orphansRemoved > 0) {
        logger.info(result, 'Retention sweep completed');
      }
    },
  });
  // server.ts starts/stops the worker with the HTTP server; tests drive `tick()` directly.
  app.locals.jobWorker = worker;
  const executorReady = () => (options.isExecutorReady ?? worker.isReady)();
  /**
   * `checks["pipeline:<id>"]` (cached Nextflow readiness) for `/health/ready`. Informational
   * only: it never makes overall readiness 503, because Smart Checkup still works. Omitted when
   * `NEXTFLOW_ENABLED=false`, where the Nextflow pipelines are intentionally not part of the
   * deployment (e.g. Docker Compose).
   */
  const pipelineChecks = (): Record<string, 'ok' | 'failed'> =>
    nextflowConfig.nextflowEnabled
      ? Object.fromEntries(
          pipelineIdsForExecutor('nextflow').map((pipelineId) => [
            `pipeline:${pipelineId}`,
            nextflowAdapter.readiness(pipelineId).ready ? 'ok' : 'failed',
          ]),
        )
      : {};

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
      const executor = executorReady() ? 'ok' : 'failed';
      response.status(executor === 'ok' ? 200 : 503).json(
        createSuccessResponse(
          {
            checks: { database: 'ok', executor, ...pipelineChecks() },
            status: executor === 'ok' ? 'ready' : 'not_ready',
          },
          getRequestId(response),
        ),
      );
    } catch {
      response.status(503).json(
        createSuccessResponse(
          {
            checks: {
              database: 'failed',
              executor: executorReady() ? 'ok' : 'failed',
              ...pipelineChecks(),
            },
            status: 'not_ready',
          },
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
  app.use(
    '/api/v1/auth',
    createIdentityRouter({
      audit,
      generateCsrfToken,
      guard,
      identity,
      loginRateLimiter: rateLimiters.login,
      sessionCookieName: SESSION_COOKIE_NAME,
    }),
  );
  app.use('/api/v1/audit-events', createAuditRouter({ audit, guard, prisma }));
  // Mounted before the Jobs router: its paths do not clash, and its per-route auth + limiter
  // chain must not run twice (the Jobs router applies its chain to every `/jobs` request).
  app.use(
    '/api/v1/jobs',
    createResultsRouter({
      audit,
      authenticatedApiLimiter: rateLimiters.authenticatedApi,
      guard,
      results,
    }),
  );
  app.use(
    '/api/v1/jobs',
    createJobsRouter({
      authenticatedApiLimiter: rateLimiters.authenticatedApi,
      guard,
      jobs,
      submitLimiter: rateLimiters.submit,
    }),
  );
  app.use(
    '/api/v1/pipelines',
    createPipelinesRouter({
      authenticatedApiLimiter: rateLimiters.authenticatedApi,
      guard,
      pipelines,
      submitLimiter: rateLimiters.submit,
    }),
  );
  app.use('/api/v1', (_request, _response, next) => {
    next(new HttpError(404, 'NOT_FOUND', 'The requested resource is unavailable.'));
  });

  app.use(createErrorMiddleware(logger));

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

function createErrorMiddleware(
  logger: ReturnType<typeof createLogger>,
): (error: unknown, request: Request, response: Response, next: NextFunction) => void {
  return (error, _request, response, next) => {
    void next;
    const requestId = getRequestId(response);

    if (error instanceof HttpError) {
      response
        .status(error.status)
        .json(createErrorResponse(error.code, error.message, requestId, error.details));
      return;
    }

    if (isBodyParseError(error)) {
      response
        .status(400)
        .json(createErrorResponse('VALIDATION_FAILED', 'Request validation failed.', requestId));
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

    logger.error({ err: error, requestId }, 'Unhandled request error');
    response
      .status(500)
      .json(createErrorResponse('INTERNAL_ERROR', 'Unable to complete the request.', requestId));
  };
}

/** Malformed JSON or an oversized body from `express.json()`. */
function isBodyParseError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    ['entity.parse.failed', 'entity.too.large'].includes(String((error as { type: unknown }).type))
  );
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

/** The simulated executor created for this app instance. */
export function getJobWorker(app: Express): JobWorker {
  return app.locals.jobWorker as JobWorker;
}
