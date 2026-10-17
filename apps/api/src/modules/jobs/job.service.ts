import {
  jobIdSchema,
  jobParametersSchema,
  type JobDetail,
  type JobInputFile,
  type JobParameters,
  type JobStatus,
  type JobSummary,
} from '@portal/shared';

import type { PrismaClient } from '../../generated/prisma/client.js';
import { assertOwnedResourceAccess, type ActorContext } from '../../shared/authorization.js';
import type { AuditService } from '../audit/audit.service.js';
import { INPUT_FILE_NAME, type JobStorage } from './job-storage.js';
import { validateInputFile, type InputIssue, type InputRow } from './input-validator.js';

const DAY_MS = 86_400_000;

export const STATUS_SUMMARIES = {
  QUEUED: 'Job accepted and queued.',
  RUNNING: 'Simulated pipeline started.',
  COMPLETED: 'Analysis completed.',
  SIMULATED_FAILURE:
    'Simulated pipeline failure requested by the training option. Submit again without it to complete.',
  HANDLER_FAILURE: 'The analysis could not produce a result. Please submit the job again.',
  INTERRUPTED: 'Processing was interrupted by a service restart. Please submit the job again.',
} as const;

/** Allowed lifecycle transitions (US-007 AC4). Nothing else is ever written. */
export const ALLOWED_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  QUEUED: ['RUNNING'],
  RUNNING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  // Transitions into CANCELLED arrive with the cancel flow (Pipeline Catalog Wave 3).
  CANCELLED: [],
};

export function isAllowedTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class JobNotFoundError extends Error {
  public constructor() {
    super('This job is unavailable.');
    this.name = 'JobNotFoundError';
  }
}

export class ServiceUnavailableError extends Error {
  public constructor() {
    super('The analysis service is not ready. No job was created.');
    this.name = 'ServiceUnavailableError';
  }
}

export class InvalidTransitionError extends Error {
  public constructor() {
    super('The status transition is not allowed.');
    this.name = 'InvalidTransitionError';
  }
}

export class InputValidationError extends Error {
  public constructor(public readonly issues: readonly InputIssue[]) {
    super('The input file is not valid.');
    this.name = 'InputValidationError';
  }
}

export type DeletionReason = 'OWNER_REQUEST' | 'RETENTION';

type FileMetadata = { name: string; sizeBytes: number; rowCount: number; markers: string[] };

type JobServiceOptions = {
  prisma: PrismaClient;
  audit: AuditService;
  storage: JobStorage;
  config: { jobRetentionDays: number };
  isExecutorReady: () => boolean;
  logger: { error: (object: Record<string, unknown>, message: string) => void };
  clock?: () => Date;
};

export type JobService = ReturnType<typeof createJobService>;

export function createJobService({
  audit,
  clock = () => new Date(),
  config,
  isExecutorReady,
  logger,
  prisma,
  storage,
}: JobServiceOptions) {
  async function submit(input: {
    actor: ActorContext;
    parameters: JobParameters;
    file: JobInputFile;
    idempotencyKey: string;
    requestId: string;
  }): Promise<{ job: JobSummary; replayed: boolean }> {
    const { actor, idempotencyKey, requestId } = input;
    const existing = await findByIdempotencyKey(actor.userId, idempotencyKey);

    if (existing) {
      return { job: existing, replayed: true };
    }

    const validated = validateInputFile(input.file.name, input.file.content);

    if (!validated.ok) {
      if (validated.unsafeFilename) {
        await audit.recordSafely({
          actorId: actor.userId,
          eventType: 'JOB_INPUT_REJECTED',
          metadata: { reason: 'UNSAFE_FILENAME' },
          outcome: 'DENIED',
          requestId,
          resourceId: null,
          resourceType: 'JOB',
        });
      }

      throw new InputValidationError(validated.issues);
    }

    if (!isExecutorReady()) {
      throw new ServiceUnavailableError();
    }

    const now = clock();
    const metadata: FileMetadata = {
      markers: validated.rows.map((row) => row.marker),
      name: validated.sanitizedName,
      rowCount: validated.rows.length,
      sizeBytes: validated.sizeBytes,
    };
    let createdJobId: string | null = null;

    try {
      const job = await prisma.$transaction(async (tx) => {
        const created = await tx.job.create({
          data: {
            createdAt: now,
            expiresAt: new Date(now.getTime() + config.jobRetentionDays * DAY_MS),
            idempotencyKey,
            ownerId: actor.userId,
            status: 'QUEUED',
          },
        });
        createdJobId = created.id;
        await tx.jobInput.create({
          data: {
            fileMetadataJson: JSON.stringify(metadata),
            jobId: created.id,
            parametersJson: JSON.stringify(input.parameters),
            storageKey: storage.storageKey(created.id, INPUT_FILE_NAME),
          },
        });
        await tx.jobStatusEvent.create({
          data: {
            jobId: created.id,
            occurredAt: now,
            safeSummary: STATUS_SUMMARIES.QUEUED,
            status: 'QUEUED',
          },
        });
        await audit.record(
          {
            actorId: actor.userId,
            eventType: 'JOB_SUBMITTED',
            metadata: { status: 'QUEUED' },
            outcome: 'SUCCESS',
            requestId,
            resourceId: created.id,
            resourceType: 'JOB',
          },
          tx,
        );
        // Written inside the transaction: a failed write rolls the job back.
        await storage.writeInput(created.id, input.file.content);

        return created;
      });

      return { job: toSummary(job, input.parameters.sampleLabel), replayed: false };
    } catch (error) {
      if (createdJobId) {
        await storage.removeJob(createdJobId).catch(() => undefined);
      }

      // A concurrent retry with the same key won the race: return its job.
      if (isUniqueViolation(error)) {
        const raced = await findByIdempotencyKey(actor.userId, idempotencyKey);

        if (raced) {
          return { job: raced, replayed: true };
        }
      }

      throw error;
    }
  }

  async function list(actor: ActorContext, page: number, limit: number) {
    const where = { ownerId: actor.userId };
    const [total, rows] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        include: { input: { select: { parametersJson: true } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        where,
      }),
    ]);

    return {
      items: rows.map((row) =>
        toSummary(row, readParameters(row.input?.parametersJson).sampleLabel),
      ),
      limit,
      page,
      total,
    };
  }

  /** Loads a job for its owner only; missing, foreign and malformed IDs are indistinguishable. */
  async function getOwnedJob(actor: ActorContext, jobId: string, requestId: string, route: string) {
    if (!jobIdSchema.safeParse(jobId).success) {
      throw new JobNotFoundError();
    }

    const job = await prisma.job.findUnique({
      include: { input: true, statusEvents: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] } },
      where: { id: jobId },
    });

    if (!job) {
      throw new JobNotFoundError();
    }

    try {
      assertOwnedResourceAccess(actor, job.ownerId);
    } catch {
      await audit.recordSafely({
        actorId: actor.userId,
        eventType: 'AUTHORIZATION_DENIED',
        metadata: { method: route.split(' ')[0], route: route.split(' ')[1] },
        outcome: 'DENIED',
        requestId,
        resourceId: job.id,
        resourceType: 'JOB',
      });
      throw new JobNotFoundError();
    }

    return job;
  }

  async function get(
    actor: ActorContext,
    jobId: string,
    requestId: string,
    route: string,
  ): Promise<JobDetail> {
    return toDetail(await getOwnedJob(actor, jobId, requestId, route));
  }

  /**
   * Applies one lifecycle transition with its status event and audit record in a single
   * transaction. The `status: from` guard makes concurrent or repeated calls harmless.
   */
  async function transition(
    jobId: string,
    from: JobStatus,
    to: JobStatus,
    safeSummary: string,
    requestId: string,
  ): Promise<boolean> {
    if (!isAllowedTransition(from, to)) {
      throw new InvalidTransitionError();
    }

    const now = clock();

    return prisma.$transaction(async (tx) => {
      const updated = await tx.job.updateMany({
        data: { status: to, updatedAt: now },
        where: { id: jobId, status: from },
      });

      if (updated.count === 0) {
        return false;
      }

      await tx.jobStatusEvent.create({ data: { jobId, occurredAt: now, safeSummary, status: to } });
      await audit.record(
        {
          actorId: null,
          eventType: 'JOB_STATUS_CHANGED',
          metadata: { from, to },
          outcome: 'SUCCESS',
          requestId,
          resourceId: jobId,
          resourceType: 'JOB',
        },
        tx,
      );

      return true;
    });
  }

  /**
   * Hard-deletes the job (cascading input, events, artifacts and recommendation) and then its
   * directory. Only the audit record remains, and it holds no input or result content.
   */
  async function remove(input: {
    jobId: string;
    actor: ActorContext | null;
    reason: DeletionReason;
    requestId: string;
    route?: string;
  }): Promise<void> {
    const { jobId, reason, requestId } = input;

    if (input.actor) {
      await getOwnedJob(input.actor, jobId, requestId, input.route ?? 'DELETE /api/v1/jobs');
    }

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.job.deleteMany({ where: { id: jobId } });

      if (deleted.count === 0) {
        throw new JobNotFoundError();
      }

      await audit.record(
        {
          actorId: input.actor?.userId ?? null,
          eventType: 'JOB_DELETED',
          metadata: { reason },
          outcome: 'SUCCESS',
          requestId,
          resourceId: jobId,
          resourceType: 'JOB',
        },
        tx,
      );
    });

    try {
      await storage.removeJob(jobId);
    } catch (error) {
      // The retention sweep removes orphaned directories on its next run.
      logger.error({ err: error, jobId }, 'Failed to remove job storage after deletion');
      await audit.recordSafely({
        actorId: input.actor?.userId ?? null,
        eventType: 'JOB_DELETED',
        metadata: { reason: 'STORAGE_CLEANUP' },
        outcome: 'FAILURE',
        requestId,
        resourceId: jobId,
        resourceType: 'JOB',
      });
    }
  }

  async function findByIdempotencyKey(ownerId: string, idempotencyKey: string) {
    const job = await prisma.job.findUnique({
      include: { input: { select: { parametersJson: true } } },
      where: { ownerId_idempotencyKey: { idempotencyKey, ownerId } },
    });

    return job ? toSummary(job, readParameters(job.input?.parametersJson).sampleLabel) : null;
  }

  return { get, getOwnedJob, list, remove, submit, transition };
}

type JobRow = {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
};

type JobDetailRow = JobRow & {
  input: { parametersJson: string; fileMetadataJson: string } | null;
  statusEvents: { status: string; occurredAt: Date; safeSummary: string | null }[];
};

export function readParameters(json: string | undefined): JobParameters {
  const parsed = jobParametersSchema.safeParse(safeJson(json));

  return parsed.success
    ? parsed.data
    : {
        ageBand: '18-29',
        focusArea: 'GENERAL',
        lifestyleFactors: [],
        sampleLabel: 'Unavailable',
        simulateFailure: false,
      };
}

export function readInputRows(content: string): InputRow[] {
  const validated = validateInputFile(INPUT_FILE_NAME, content);
  return validated.ok ? validated.rows : [];
}

// Smart Checkup defaults for the Pipeline Catalog DTO fields until the executor port lands.
const SMART_CHECKUP_PIPELINE = {
  pipelineId: 'smart-checkup',
  pipelineName: 'Smart Checkup',
} as const;

function toSummary(job: JobRow, sampleLabel: string): JobSummary {
  return {
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt.toISOString(),
    id: job.id,
    ...SMART_CHECKUP_PIPELINE,
    progress: null,
    queuePosition: null,
    runName: sampleLabel,
    sampleLabel,
    status: job.status as JobStatus,
    updatedAt: job.updatedAt.toISOString(),
  };
}

function toDetail(job: JobDetailRow): JobDetail {
  const parameters = readParameters(job.input?.parametersJson);
  const metadata = safeJson(job.input?.fileMetadataJson) as Partial<FileMetadata> | null;
  const failed = job.status === 'FAILED';
  const lastEvent = job.statusEvents.at(-1);

  return {
    ...toSummary(job, parameters.sampleLabel),
    cancellable: false,
    outputs: null,
    run: null,
    failureSummary: failed ? (lastEvent?.safeSummary ?? STATUS_SUMMARIES.HANDLER_FAILURE) : null,
    file: {
      name: String(metadata?.name ?? INPUT_FILE_NAME),
      rowCount: Number(metadata?.rowCount ?? 0),
      sizeBytes: Number(metadata?.sizeBytes ?? 0),
    },
    history: job.statusEvents.map((event) => ({
      occurredAt: event.occurredAt.toISOString(),
      status: event.status as JobStatus,
      summary: event.safeSummary,
    })),
    parameters,
    statusUrl: `/jobs/${job.id}`,
  };
}

function safeJson(value: string | undefined): unknown {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}
