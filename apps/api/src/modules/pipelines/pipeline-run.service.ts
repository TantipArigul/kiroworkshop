import { lstat, readdir } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

import {
  FASTQ_EXTENSIONS,
  RUN_INPUT_MAX_BYTES,
  RUN_INPUT_MAX_FASTQ_FILES,
  RUN_INPUT_RELATIVE_PATH_MAX_LENGTH,
  SAMPLE_SHEET_MAX_BYTES,
  type JobSummary,
  type PipelineDetail,
  type PipelineId,
  type PipelineSummary,
  type PipelineUnavailableReason,
} from '@portal/shared';

import type { ActorContext } from '../../shared/authorization.js';
import type { AuditService } from '../audit/audit.service.js';
import type { TransactionClient } from '../jobs/executor.js';
import type { JobStorage } from '../jobs/job-storage.js';
import type { JobService } from '../jobs/job.service.js';
import { getPipelineDefinition, PIPELINE_REGISTRY, type PipelineDefinition } from './registry.js';
import { validateLaunch, type RunInputIssue } from './run-input-validator.js';
import { receiveRunUpload, UploadRejectedError, type RunUploadLimits } from './run-upload.js';

const OUTPUT_FILES_MAX = 1000;

export type PipelineAvailability = {
  available: boolean;
  unavailableReason: PipelineUnavailableReason | null;
};

export class PipelineNotFoundError extends Error {
  public constructor() {
    super('This pipeline is not in the catalog.');
    this.name = 'PipelineNotFoundError';
  }
}

export class PipelineUnavailableError extends Error {
  public constructor() {
    super('This pipeline is not available right now. No run was created.');
    this.name = 'PipelineUnavailableError';
  }
}

/** Launch fields or files failed validation (C4); nothing was kept. */
export class RunValidationError extends Error {
  public constructor(public readonly issues: readonly RunInputIssue[]) {
    super('The run input is not valid.');
    this.name = 'RunValidationError';
  }
}

export class OutputManifestError extends Error {
  public constructor() {
    super('The run did not produce the required outputs.');
    this.name = 'OutputManifestError';
  }
}

type PipelineRunServiceOptions = {
  audit: AuditService;
  jobs: JobService;
  storage: JobStorage;
  availability: (pipelineId: PipelineId) => PipelineAvailability;
  uploadLimits?: RunUploadLimits;
  logger: {
    info: (object: Record<string, unknown>, message: string) => void;
    warn: (object: Record<string, unknown>, message: string) => void;
  };
};

export type PipelineRunService = ReturnType<typeof createPipelineRunService>;

/** Pipeline catalog and Nextflow launches (design C5). */
export function createPipelineRunService(options: PipelineRunServiceOptions) {
  const { audit, availability, jobs, logger, storage } = options;

  function listPipelines(): PipelineSummary[] {
    return PIPELINE_REGISTRY.map(toSummary);
  }

  function getPipeline(pipelineId: string): PipelineDetail {
    const definition = getPipelineDefinition(pipelineId);

    if (!definition) {
      throw new PipelineNotFoundError();
    }

    return {
      ...toSummary(definition),
      limits:
        definition.executor === 'nextflow'
          ? {
              fastqExtensions: [...FASTQ_EXTENSIONS],
              maxFastqFiles: RUN_INPUT_MAX_FASTQ_FILES,
              maxTotalBytes: RUN_INPUT_MAX_BYTES,
              sampleSheetMaxBytes: SAMPLE_SHEET_MAX_BYTES,
            }
          : null,
      options: [...definition.options],
    };
  }

  /**
   * `POST /pipelines/{id}/runs`: replay → availability (before any byte is read) → streaming
   * upload → validation → QUEUED job whose transaction moves the staging directory to
   * `jobs/{id}/input`. Every failure path removes the staging directory.
   */
  async function launch(input: {
    actor: ActorContext;
    pipelineId: string;
    idempotencyKey: string;
    request: IncomingMessage;
    requestId: string;
  }): Promise<{ job: JobSummary; replayed: boolean }> {
    const { actor, idempotencyKey, requestId } = input;
    const definition = getPipelineDefinition(input.pipelineId);

    if (!definition?.nextflow) {
      throw new PipelineNotFoundError();
    }

    const existing = await jobs.findByIdempotencyKey(actor.userId, idempotencyKey);

    if (existing) {
      logger.info({ jobId: existing.id, pipelineId: definition.id }, 'Launch replayed');
      return { job: existing, replayed: true };
    }

    if (!availability(definition.id).available) {
      logger.warn({ pipelineId: definition.id }, 'Launch refused: pipeline unavailable');
      throw new PipelineUnavailableError();
    }

    let upload: Awaited<ReturnType<typeof receiveRunUpload>>;

    try {
      upload = await receiveRunUpload({
        limits: options.uploadLimits,
        request: input.request,
        storage,
      });
    } catch (error) {
      if (error instanceof UploadRejectedError) {
        logger.warn({ reason: error.auditReason ?? 'INVALID_UPLOAD' }, 'Upload rejected');

        if (error.auditReason) {
          await audit.recordSafely({
            actorId: actor.userId,
            eventType: 'JOB_INPUT_REJECTED',
            metadata: { reason: error.auditReason },
            outcome: 'DENIED',
            requestId,
            resourceId: null,
            resourceType: 'JOB',
          });
        }
      }

      throw error;
    }

    const validated = validateLaunch(upload);

    if (!validated.ok) {
      await storage.removeUpload(upload.uploadId).catch(() => undefined);
      logger.warn({ reason: 'VALIDATION_FAILED' }, 'Upload rejected');
      throw new RunValidationError(validated.issues);
    }

    const run = validated.input;

    try {
      const result = await jobs.createQueuedJob({
        actor,
        fileMetadata: {
          barcodes: run.barcodes,
          fileCount: run.fileCount,
          totalBytes: run.totalBytes,
        },
        idempotencyKey,
        inputFiles: run.files,
        materialize: (jobId) => storage.moveUploadToJobInput(upload.uploadId, jobId),
        parameters: { layout: run.layout, options: run.options, sampleName: run.sampleName },
        pipelineId: definition.id,
        pipelineRevision: definition.nextflow?.revision ?? definition.version,
        requestId,
        runName: run.runName,
        storageKey: (jobId) => storage.storageKey(jobId, 'input'),
      });

      logger.info(
        { jobId: result.job.id, pipelineId: definition.id },
        result.replayed ? 'Launch replayed' : 'Launch accepted',
      );

      return result;
    } finally {
      // After a successful move this is a no-op; otherwise it removes the staging directory.
      await storage.removeUpload(upload.uploadId).catch(() => undefined);
    }
  }

  function toSummary(definition: PipelineDefinition): PipelineSummary {
    const state = availability(definition.id);

    return {
      available: state.available,
      description: definition.description,
      executor: definition.executor,
      id: definition.id,
      inputLayouts: [...definition.inputLayouts],
      name: definition.name,
      unavailableReason: state.available ? null : state.unavailableReason,
      version: definition.version,
    };
  }

  return { getPipeline, launch, listPipelines, recordOutputs };
}

/**
 * Output manifest (C5): walks `jobs/{id}/output/` without following symlinks and records every
 * regular file as a `JobOutputFile` in the COMPLETED transaction. A missing required output
 * throws, so the job becomes FAILED instead.
 */
export async function recordOutputs(
  tx: TransactionClient,
  input: { jobId: string; storage: JobStorage; requiredOutputs: readonly string[] },
): Promise<void> {
  const root = input.storage.jobSubdirectory(input.jobId, 'output');
  const files = await listOutputFiles(root);
  const required = input.requiredOutputs.map(globToRegExp);

  if (!required.every((pattern) => files.some((file) => pattern.test(file.relativePath)))) {
    throw new OutputManifestError();
  }

  if (files.length > 0) {
    await tx.jobOutputFile.createMany({
      data: files.map((file) => ({
        category: outputCategory(file.relativePath),
        contentType: contentTypeOf(file.relativePath),
        jobId: input.jobId,
        relativePath: file.relativePath,
        sizeBytes: file.sizeBytes,
      })),
    });
  }
}

async function listOutputFiles(
  root: string,
): Promise<{ relativePath: string; sizeBytes: number }[]> {
  const found: { relativePath: string; sizeBytes: number }[] = [];
  const queue: string[] = [''];

  while (queue.length > 0) {
    const relativeDirectory = queue.shift() ?? '';
    let entries;

    try {
      entries = await readdir(join(root, relativeDirectory), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && relativeDirectory === '') {
        return [];
      }

      throw error;
    }

    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      // lstat: symlinks are neither followed nor recorded.
      const stats = await lstat(join(root, relativePath));

      if (stats.isDirectory()) {
        queue.push(relativePath);
      } else if (stats.isFile()) {
        if (
          relativePath.length > RUN_INPUT_RELATIVE_PATH_MAX_LENGTH ||
          found.length >= OUTPUT_FILES_MAX
        ) {
          throw new OutputManifestError();
        }

        found.push({ relativePath, sizeBytes: stats.size });
      }
    }
  }

  return found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');

  return new RegExp(`^${escaped}$`);
}

function outputCategory(relativePath: string): 'READS' | 'STATS' | 'REPORT' | 'OTHER' {
  if (relativePath.startsWith('fastq/')) {
    return 'READS';
  }

  if (relativePath.startsWith('stats/')) {
    return 'STATS';
  }

  return relativePath.endsWith('.html') ? 'REPORT' : 'OTHER';
}

const CONTENT_TYPES: readonly [string, string][] = [
  ['.fastq.gz', 'application/gzip'],
  ['.fq.gz', 'application/gzip'],
  ['.gz', 'application/gzip'],
  ['.fastq', 'text/plain'],
  ['.fq', 'text/plain'],
  ['.tsv', 'text/tab-separated-values'],
  ['.csv', 'text/csv'],
  ['.txt', 'text/plain'],
  ['.json', 'application/json'],
  ['.yml', 'application/yaml'],
  ['.yaml', 'application/yaml'],
  ['.html', 'text/html'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
];

function contentTypeOf(relativePath: string): string {
  return (
    CONTENT_TYPES.find(([extension]) => relativePath.endsWith(extension))?.[1] ??
    'application/octet-stream'
  );
}
