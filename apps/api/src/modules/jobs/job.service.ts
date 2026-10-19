import {
  ACTIVE_JOB_STATUSES,
  jobIdSchema,
  jobParametersSchema,
  jobProgressSchema,
  renamefastqOptionsSchema,
  runInputFileKindSchema,
  runInputLayoutSchema,
  type JobDetail,
  type JobInputFile,
  type JobParameters,
  type JobProgress,
  type JobRunInfo,
  type JobStatus,
  type JobSummary,
  type PipelineId,
} from '@portal/shared';
import { z } from 'zod';

import type { PrismaClient } from '../../generated/prisma/client.js';
import { assertOwnedResourceAccess, type ActorContext } from '../../shared/authorization.js';
import type { AuditService } from '../audit/audit.service.js';
import { getPipelineDefinition, pipelineIdsSharingExecutor } from '../pipelines/registry.js';
import type { ExecutorDirectory, TransactionClient } from './executor.js';
import { INPUT_FILE_NAME, type JobStorage } from './job-storage.js';
import { validateInputFile, type InputIssue, type InputRow } from './input-validator.js';

const DAY_MS = 86_400_000;
const SMART_CHECKUP_PIPELINE_ID = 'smart-checkup';
const SMART_CHECKUP_REVISION = 'builtin';
/** Upload paths are stored relative to `jobs/{id}/input`; FASTQ files live under `fastq/`. */
const FASTQ_STORAGE_PREFIX = 'fastq/';

export const STATUS_SUMMARIES = {
  QUEUED: 'Job accepted and queued.',
  RUNNING: 'Simulated pipeline started.',
  COMPLETED: 'Analysis completed.',
  SIMULATED_FAILURE:
    'Simulated pipeline failure requested by the training option. Submit again without it to complete.',
  HANDLER_FAILURE: 'The analysis could not produce a result. Please submit the job again.',
  INTERRUPTED: 'Processing was interrupted by a service restart. Please submit the job again.',
  RUN_STARTED: 'Run started.',
  RUN_COMPLETED: 'Run completed.',
  START_FAILURE: 'The run could not start. Please submit it again.',
  CANCELLED: 'Cancelled by the owner.',
} as const;

/** Allowed lifecycle transitions (US-007 AC4 as adjusted, US-021 AC1). Nothing else is written. */
export const ALLOWED_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
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

/** Cancel of a job that already reached a terminal status (`409 CONFLICT`). */
export class ConflictError extends Error {
  public constructor() {
    super('This job has already finished.');
    this.name = 'ConflictError';
  }
}

export class InputValidationError extends Error {
  public constructor(public readonly issues: readonly InputIssue[]) {
    super('The input file is not valid.');
    this.name = 'InputValidationError';
  }
}

export type DeletionReason = 'OWNER_REQUEST' | 'RETENTION';

export type TransitionOptions = {
  /** User who caused the transition (recorded as the audit actor), e.g. the canceller. */
  actorId?: string | null;
  /** Runs inside the status transaction (e.g. the Nextflow output manifest for COMPLETED). */
  inTx?: (tx: TransactionClient) => Promise<void>;
};

export type QueuedJobInputFile = {
  relativePath: string;
  sizeBytes: number;
  kind: 'FASTQ' | 'SAMPLE_SHEET';
};

export type CreateQueuedJobInput = {
  actor: ActorContext;
  pipelineId: PipelineId;
  pipelineRevision: string;
  runName: string;
  parameters: unknown;
  fileMetadata: unknown;
  /** Relative storage key of the job input (file or directory), never an absolute path. */
  storageKey: (jobId: string) => string;
  inputFiles?: readonly QueuedJobInputFile[];
  idempotencyKey: string;
  requestId: string;
  /** Writes or moves the input into `jobs/{jobId}/`; a failure rolls the job back. */
  materialize: (jobId: string) => Promise<void>;
};

type FileMetadata = { name: string; sizeBytes: number; rowCount: number; markers: string[] };

type JobServiceOptions = {
  prisma: PrismaClient;
  audit: AuditService;
  storage: JobStorage;
  config: { jobRetentionDays: number };
  isExecutorReady: () => boolean;
  /** Adapters that stop running work on cancel/delete; optional for tests of the lifecycle only. */
  executors?: ExecutorDirectory;
  logger: { error: (object: Record<string, unknown>, message: string) => void };
  clock?: () => Date;
};

export type JobService = ReturnType<typeof createJobService>;

export function createJobService({
  audit,
  clock = () => new Date(),
  config,
  executors,
  isExecutorReady,
  logger,
  prisma,
  storage,
}: JobServiceOptions) {
  /** Smart Checkup submission (`POST /jobs`), now created through `createQueuedJob`. */
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

    const metadata: FileMetadata = {
      markers: validated.rows.map((row) => row.marker),
      name: validated.sanitizedName,
      rowCount: validated.rows.length,
      sizeBytes: validated.sizeBytes,
    };

    return createQueuedJob({
      actor,
      fileMetadata: metadata,
      idempotencyKey,
      materialize: (jobId) => storage.writeInput(jobId, input.file.content),
      parameters: input.parameters,
      pipelineId: SMART_CHECKUP_PIPELINE_ID,
      pipelineRevision: SMART_CHECKUP_REVISION,
      requestId,
      runName: input.parameters.sampleLabel,
      storageKey: (jobId) => storage.storageKey(jobId, INPUT_FILE_NAME),
    });
  }

  /**
   * Creates a QUEUED job with its input, input files, first status event and audit record in
   * one transaction. `materialize` runs inside it, so a failed write leaves no job behind.
   */
  async function createQueuedJob(
    input: CreateQueuedJobInput,
  ): Promise<{ job: JobSummary; replayed: boolean }> {
    const { actor, idempotencyKey, requestId } = input;
    const now = clock();
    let createdJobId: string | null = null;

    try {
      const job = await prisma.$transaction(async (tx) => {
        const created = await tx.job.create({
          data: {
            createdAt: now,
            expiresAt: new Date(now.getTime() + config.jobRetentionDays * DAY_MS),
            idempotencyKey,
            ownerId: actor.userId,
            pipelineId: input.pipelineId,
            pipelineRevision: input.pipelineRevision,
            runName: input.runName,
            status: 'QUEUED',
          },
        });
        createdJobId = created.id;
        await tx.jobInput.create({
          data: {
            fileMetadataJson: JSON.stringify(input.fileMetadata),
            jobId: created.id,
            parametersJson: JSON.stringify(input.parameters),
            storageKey: input.storageKey(created.id),
          },
        });

        if (input.inputFiles && input.inputFiles.length > 0) {
          await tx.jobInputFile.createMany({
            data: input.inputFiles.map((file) => ({ ...file, jobId: created.id })),
          });
        }

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
            // Smart Checkup keeps its Unit 2 metadata; catalog runs also name the pipeline.
            metadata:
              input.pipelineId === SMART_CHECKUP_PIPELINE_ID
                ? { status: 'QUEUED' }
                : { pipelineId: input.pipelineId, status: 'QUEUED' },
            outcome: 'SUCCESS',
            requestId,
            resourceId: created.id,
            resourceType: 'JOB',
          },
          tx,
        );
        await input.materialize(created.id);

        return created;
      });

      return { job: await toSummary(job), replayed: false };
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
      items: await Promise.all(rows.map((row) => toSummary(row))),
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
      include: {
        input: true,
        inputFiles: {
          orderBy: { relativePath: 'asc' },
          select: { kind: true, relativePath: true, sizeBytes: true },
        },
        outputFiles: { select: { sizeBytes: true } },
        statusEvents: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
      },
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
    options: TransitionOptions = {},
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
          actorId: options.actorId ?? null,
          eventType: 'JOB_STATUS_CHANGED',
          metadata: { from, to },
          outcome: 'SUCCESS',
          requestId,
          resourceId: jobId,
          resourceType: 'JOB',
        },
        tx,
      );

      if (options.inTx) {
        await options.inTx(tx);
      }

      return true;
    });
  }

  /** Stores the latest progress of a RUNNING job (no status event; it is not a transition). */
  async function recordProgress(jobId: string, progress: JobProgress): Promise<void> {
    await prisma.job.updateMany({
      data: { progressJson: JSON.stringify(progress) },
      where: { id: jobId, status: 'RUNNING' },
    });
  }

  /**
   * Owner cancel (US-021): QUEUED → CANCELLED, or RUNNING → CANCELLED first and then the
   * adapter stops the process and cleans up in the background, so the request never waits
   * for the run to exit. Terminal jobs answer `ConflictError`.
   */
  async function cancel(actor: ActorContext, jobId: string, requestId: string) {
    const job = await getOwnedJob(actor, jobId, requestId, 'POST /api/v1/jobs/:jobId/cancel');
    let status = job.status as JobStatus;

    // At most two attempts: the worker may move QUEUED → RUNNING between read and update.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (status !== 'QUEUED' && status !== 'RUNNING') {
        throw new ConflictError();
      }

      const from = status;
      const applied = await transition(
        jobId,
        from,
        'CANCELLED',
        STATUS_SUMMARIES.CANCELLED,
        requestId,
        { actorId: actor.userId },
      );

      if (applied) {
        if (from === 'RUNNING') {
          void _stopAndCleanUp(job.pipelineId, jobId);
        }

        const updated = await prisma.job.findUniqueOrThrow({
          include: { input: { select: { parametersJson: true } } },
          where: { id: jobId },
        });

        return toSummary(updated);
      }

      const current = await prisma.job.findUnique({
        select: { status: true },
        where: { id: jobId },
      });

      if (!current) {
        throw new JobNotFoundError();
      }

      status = current.status as JobStatus;
    }

    throw new ConflictError();
  }

  /**
   * Hard-deletes the job (cascading input, events, artifacts and recommendation) and then its
   * directory. A RUNNING job's process is stopped first. Only the audit record remains, and it
   * holds no input or result content.
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

    const current = await prisma.job.findUnique({
      select: { pipelineId: true, status: true },
      where: { id: jobId },
    });
    const adapter = current ? (executors?.adapterFor(current.pipelineId) ?? null) : null;

    if (adapter && current?.status === 'RUNNING') {
      // Waits up to the adapter's grace period so no process writes into a deleted directory.
      await adapter.cancel(jobId);
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

    if (adapter) {
      await adapter.cleanup(jobId, 'CANCELLED').catch(() => undefined);
    }

    try {
      await storage.removeJob(jobId);
    } catch (error) {
      // The retention sweep removes orphaned directories on its next run.
      // Error type only: file-system errors carry absolute storage paths in their message.
      logger.error(
        { errorType: error instanceof Error ? error.name : 'unknown', jobId },
        'Failed to remove job storage after deletion',
      );
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

    return job ? toSummary(job) : null;
  }

  async function toSummary(job: JobRow): Promise<JobSummary> {
    const runName =
      job.runName ||
      (job.pipelineId === SMART_CHECKUP_PIPELINE_ID
        ? readParameters(job.input?.parametersJson).sampleLabel
        : '');

    return {
      createdAt: job.createdAt.toISOString(),
      expiresAt: job.expiresAt.toISOString(),
      id: job.id,
      pipelineId: toPipelineId(job.pipelineId),
      pipelineName: getPipelineDefinition(job.pipelineId)?.name ?? job.pipelineId,
      // Progress describes a run in flight; finished jobs report their outcome instead.
      progress: job.status === 'RUNNING' ? readProgress(job.progressJson) : null,
      queuePosition: await queuePosition(job),
      runName,
      sampleLabel: runName,
      status: job.status as JobStatus,
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  /** 1-based position among QUEUED jobs of the same executor (all owners; count only). */
  async function queuePosition(job: JobRow): Promise<number | null> {
    if (job.status !== 'QUEUED') {
      return null;
    }

    const ahead = await prisma.job.count({
      where: {
        OR: [
          { createdAt: { lt: job.createdAt } },
          { createdAt: job.createdAt, id: { lt: job.id } },
        ],
        pipelineId: { in: pipelineIdsSharingExecutor(job.pipelineId) },
        status: 'QUEUED',
      },
    });

    return ahead + 1;
  }

  async function toDetail(job: JobDetailRow): Promise<JobDetail> {
    const smartCheckup = job.pipelineId === SMART_CHECKUP_PIPELINE_ID;
    const metadata = safeJson(job.input?.fileMetadataJson) as Partial<FileMetadata> | null;
    const failed = job.status === 'FAILED';
    const lastEvent = job.statusEvents.at(-1);

    return {
      ...(await toSummary(job)),
      cancellable: (ACTIVE_JOB_STATUSES as readonly string[]).includes(job.status),
      failureSummary: failed ? (lastEvent?.safeSummary ?? STATUS_SUMMARIES.HANDLER_FAILURE) : null,
      file: smartCheckup
        ? {
            name: String(metadata?.name ?? INPUT_FILE_NAME),
            rowCount: Number(metadata?.rowCount ?? 0),
            sizeBytes: Number(metadata?.sizeBytes ?? 0),
          }
        : null,
      history: job.statusEvents.map((event) => ({
        occurredAt: event.occurredAt.toISOString(),
        status: event.status as JobStatus,
        summary: event.safeSummary,
      })),
      outputs:
        !smartCheckup && job.status === 'COMPLETED'
          ? {
              fileCount: job.outputFiles.length,
              totalBytes: job.outputFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
            }
          : null,
      parameters: smartCheckup ? readParameters(job.input?.parametersJson) : null,
      run: smartCheckup ? null : readRunInfo(job),
      statusUrl: `/jobs/${job.id}`,
    };
  }

  async function _stopAndCleanUp(pipelineId: string, jobId: string): Promise<void> {
    const adapter = executors?.adapterFor(pipelineId);

    if (!adapter) {
      return;
    }

    try {
      await adapter.cancel(jobId);
      await adapter.cleanup(jobId, 'CANCELLED');
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : 'unknown', jobId },
        'Failed to stop a cancelled job',
      );
    }
  }

  return {
    cancel,
    createQueuedJob,
    findByIdempotencyKey,
    get,
    getOwnedJob,
    list,
    recordProgress,
    remove,
    submit,
    transition,
  };
}

type JobRow = {
  id: string;
  status: string;
  pipelineId: string;
  runName: string;
  progressJson: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  input?: { parametersJson: string } | null;
};

type JobDetailRow = JobRow & {
  input: { parametersJson: string; fileMetadataJson: string } | null;
  inputFiles: { relativePath: string; sizeBytes: number; kind: string }[];
  outputFiles: { sizeBytes: number }[];
  statusEvents: { status: string; occurredAt: Date; safeSummary: string | null }[];
};

const runParametersSchema = z.object({
  layout: runInputLayoutSchema,
  sampleName: z.string().max(64).nullable(),
  options: renamefastqOptionsSchema,
});

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

function readProgress(json: string | null): JobProgress | null {
  const parsed = jobProgressSchema.safeParse(safeJson(json ?? undefined));
  return parsed.success ? parsed.data : null;
}

/** Nextflow run summary; FASTQ paths are shown as uploaded (without the storage prefix). */
function readRunInfo(job: JobDetailRow): JobRunInfo | null {
  const parsed = runParametersSchema.safeParse(safeJson(job.input?.parametersJson));

  if (!parsed.success) {
    return null;
  }

  return {
    files: job.inputFiles.flatMap((file) => {
      const kind = runInputFileKindSchema.safeParse(file.kind);

      if (!kind.success) {
        return [];
      }

      return [
        {
          kind: kind.data,
          relativePath:
            kind.data === 'FASTQ' && file.relativePath.startsWith(FASTQ_STORAGE_PREFIX)
              ? file.relativePath.slice(FASTQ_STORAGE_PREFIX.length)
              : file.relativePath,
          sizeBytes: file.sizeBytes,
        },
      ];
    }),
    layout: parsed.data.layout,
    options: parsed.data.options,
    sampleName: parsed.data.sampleName,
  };
}

function toPipelineId(value: string): PipelineId {
  return getPipelineDefinition(value)?.id ?? SMART_CHECKUP_PIPELINE_ID;
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
