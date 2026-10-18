import { lstat, readFile } from 'node:fs/promises';

import {
  artifactIdSchema,
  nextflowResultSchema,
  NO_MOCK_RECOMMENDATION_RULE_ID,
  recommendationSchema,
  smartCheckupResultSchema,
  type JobResult,
  type JobStatus,
  type NextflowResult,
  type Recommendation,
  type ResultArtifact,
  type ResultArtifactCategory,
  type SmartCheckupResult,
} from '@portal/shared';
import { z } from 'zod';

import type { PrismaClient } from '../../generated/prisma/client.js';
import { resolvePrivateStoragePath, StoragePathError } from '../../infrastructure/storage-path.js';
import type { ActorContext } from '../../shared/authorization.js';
import type { JobStorage } from '../jobs/job-storage.js';
import type { JobService } from '../jobs/job.service.js';
import type { JobOutputFileEntry, PipelineRunService } from '../pipelines/pipeline-run.service.js';
import { NEXTFLOW_STATS_RELATIVE_PATH, readNextflowStats } from './nextflow-stats.js';
import { referencesFor } from './references.js';
import { reportPolicy } from './report-policy.js';
import {
  smartCheckupResultFileSchema,
  type SmartCheckupResultFile,
} from './smart-checkup-result.js';

const SMART_CHECKUP_PIPELINE_ID = 'smart-checkup';
const NEXTFLOW_PIPELINE_ID = 'wf-renamefastq';
const RESULT_ROUTE = 'GET /api/v1/jobs/:jobId/result';
const matchedFactorsSchema = z.array(z.string());

/** `409 CONFLICT`: the job is not COMPLETED, so no output exists yet (US-009 AC2). */
export class ResultNotReadyError extends Error {
  public constructor(public readonly jobStatus: JobStatus) {
    super('The result is available only after the job has completed.');
    this.name = 'ResultNotReadyError';
  }
}

/** `410 GONE`: the job is COMPLETED but its result files or rows are no longer available. */
export class ResultUnavailableError extends Error {
  public constructor(public readonly reason: 'MISSING' | 'INVALID') {
    super('The result files are no longer available.');
    this.name = 'ResultUnavailableError';
  }
}

/** `500`: a stored Smart Checkup result does not match its schema (safe message only). */
export class ResultCorruptError extends Error {
  public constructor() {
    super('The stored result could not be read.');
    this.name = 'ResultCorruptError';
  }
}

/** `404`: unknown, malformed or foreign artifact (indistinguishable on purpose). */
export class ArtifactNotFoundError extends Error {
  public constructor() {
    super('This file is unavailable.');
    this.name = 'ArtifactNotFoundError';
  }
}

/** A file the caller may stream; `absolutePath` never leaves the API. */
export type ResolvedArtifact = {
  id: string;
  absolutePath: string;
  /** Path relative to the job output (Nextflow) or the generated file name (Smart Checkup). */
  displayName: string;
  category: ResultArtifactCategory;
  viewable: boolean;
};

type ResultServiceOptions = {
  /** The results module owns `ResultArtifact` and `PackageRecommendation` (design C5). */
  prisma: Pick<PrismaClient, 'resultArtifact' | 'packageRecommendation'>;
  jobs: Pick<JobService, 'getOwnedJob'>;
  pipelines: Pick<PipelineRunService, 'listOutputFiles'>;
  storage: Pick<JobStorage, 'jobDirectory' | 'jobSubdirectory'>;
};

export type ResultService = ReturnType<typeof createResultService>;

/**
 * Result Service (design C5). Reads job state only through `JobService.getOwnedJob` (owner
 * check + audit denial) and Nextflow outputs only through `PipelineRunService.listOutputFiles`.
 */
export function createResultService({ jobs, pipelines, prisma, storage }: ResultServiceOptions) {
  async function getResult(
    actor: ActorContext,
    jobId: string,
    requestId: string,
  ): Promise<JobResult> {
    const job = await _completedJob(actor, jobId, requestId, RESULT_ROUTE);

    if (job.pipelineId === SMART_CHECKUP_PIPELINE_ID) {
      return _smartCheckupResult(job.id, job.runName);
    }

    if (job.pipelineId === NEXTFLOW_PIPELINE_ID) {
      return _nextflowResult(job.id, job.runName);
    }

    throw new ResultCorruptError();
  }

  /**
   * Owner + COMPLETED, then the artifact by `{ id, jobId }` in `ResultArtifact` (Smart Checkup)
   * or the job's output manifest (Nextflow). The path is confined to `jobs/{jobId}/`.
   */
  async function getArtifact(
    actor: ActorContext,
    jobId: string,
    artifactId: string,
    requestId: string,
    route: string,
  ): Promise<ResolvedArtifact> {
    const job = await _completedJob(actor, jobId, requestId, route);

    if (!artifactIdSchema.safeParse(artifactId).success) {
      throw new ArtifactNotFoundError();
    }

    if (job.pipelineId === SMART_CHECKUP_PIPELINE_ID) {
      const artifact = await prisma.resultArtifact.findFirst({
        select: { fileName: true, id: true, storageKey: true },
        where: { deletedAt: null, id: artifactId, jobId: job.id },
      });

      if (!artifact) {
        throw new ArtifactNotFoundError();
      }

      return {
        absolutePath: _confined(() => _resultFilePath(job.id, artifact.storageKey)),
        category: 'RESULT',
        displayName: artifact.fileName,
        id: artifact.id,
        viewable: false,
      };
    }

    const file = (await pipelines.listOutputFiles(job.id)).find((entry) => entry.id === artifactId);

    if (!file) {
      throw new ArtifactNotFoundError();
    }

    return {
      absolutePath: _confined(() => _outputFilePath(job.id, file.relativePath)),
      category: file.category,
      displayName: file.relativePath,
      id: file.id,
      viewable: reportPolicy({ ...file, pipelineId: job.pipelineId }).viewable,
    };
  }

  async function _completedJob(
    actor: ActorContext,
    jobId: string,
    requestId: string,
    route: string,
  ) {
    const job = await jobs.getOwnedJob(actor, jobId, requestId, route);

    if (job.status !== 'COMPLETED') {
      throw new ResultNotReadyError(job.status as JobStatus);
    }

    return job;
  }

  async function _smartCheckupResult(jobId: string, runName: string): Promise<SmartCheckupResult> {
    const [artifact, recommendation] = await Promise.all([
      prisma.resultArtifact.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { contentType: true, fileName: true, id: true, storageKey: true },
        where: { deletedAt: null, jobId },
      }),
      prisma.packageRecommendation.findUnique({ where: { jobId } }),
    ]);

    // A job completed before Results & Guidance has no rows (not backfilled — D4-8).
    if (!artifact || !recommendation) {
      throw new ResultUnavailableError('MISSING');
    }

    const { content, sizeBytes } = await _readResultFile(jobId, artifact.storageKey);
    const parsed = smartCheckupResultFileSchema.safeParse(_parseJson(content));

    if (!parsed.success) {
      throw new ResultCorruptError();
    }

    const file = parsed.data;
    const result = smartCheckupResultSchema.safeParse({
      artifacts: [
        {
          category: 'RESULT',
          contentType: artifact.contentType,
          displayName: artifact.fileName,
          id: artifact.id,
          kind: 'RESULT',
          sizeBytes,
          viewable: false,
          viewNote: null,
        } satisfies ResultArtifact,
      ],
      markers: file.markers,
      pipelineId: SMART_CHECKUP_PIPELINE_ID,
      recommendation: _storedRecommendation(recommendation, file),
      references: referencesFor(SMART_CHECKUP_PIPELINE_ID),
      summary: {
        ageBand: file.parameters.ageBand,
        focusArea: file.parameters.focusArea,
        generatedAt: file.generatedAt,
        lifestyleFactors: file.parameters.lifestyleFactors,
        markerCount: file.markers.length,
        runName: runName || file.parameters.sampleLabel,
      },
    });

    if (!result.success) {
      throw new ResultCorruptError();
    }

    return result.data;
  }

  async function _nextflowResult(jobId: string, runName: string): Promise<NextflowResult> {
    const files = await pipelines.listOutputFiles(jobId);
    const statsFile = files.find((file) => file.relativePath === NEXTFLOW_STATS_RELATIVE_PATH);

    if (!statsFile) {
      throw new ResultUnavailableError('MISSING');
    }

    let statsPath: string;

    try {
      statsPath = _outputFilePath(jobId, statsFile.relativePath);
    } catch {
      throw new ResultUnavailableError('INVALID');
    }

    const stats = await readNextflowStats(statsPath);

    if (!stats.ok) {
      throw new ResultUnavailableError(stats.reason);
    }

    const result = nextflowResultSchema.safeParse({
      artifacts: files.map((file) => _outputArtifact(file)),
      pipelineId: NEXTFLOW_PIPELINE_ID,
      references: referencesFor(NEXTFLOW_PIPELINE_ID),
      samples: stats.samples,
      summary: {
        outputBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
        outputFileCount: files.length,
        runName,
        sampleCount: stats.samples.length,
        totalBases: stats.samples.reduce((sum, sample) => sum + sample.sumLen, 0),
        totalReads: stats.samples.reduce((sum, sample) => sum + sample.numSeqs, 0),
      },
    });

    if (!result.success) {
      throw new ResultUnavailableError('INVALID');
    }

    return result.data;
  }

  /** `result.json` under `jobs/{jobId}/` (lstat: no symlinks); a missing file is `410`. */
  async function _readResultFile(
    jobId: string,
    storageKey: string,
  ): Promise<{ content: string; sizeBytes: number }> {
    let path: string;

    try {
      path = _resultFilePath(jobId, storageKey);
    } catch {
      throw new ResultCorruptError();
    }

    try {
      const stats = await lstat(path);

      if (!stats.isFile()) {
        throw new ResultCorruptError();
      }

      return { content: await readFile(path, 'utf8'), sizeBytes: stats.size };
    } catch (error) {
      if (error instanceof ResultCorruptError) {
        throw error;
      }

      // File-system errors carry absolute paths: only a typed error leaves this function.
      throw (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? new ResultUnavailableError('MISSING')
        : new ResultCorruptError();
    }
  }

  /** Stored key `jobs/{jobId}/<file>` resolved inside the job directory only. */
  function _resultFilePath(jobId: string, storageKey: string): string {
    const prefix = `jobs/${jobId}/`;

    if (!storageKey.startsWith(prefix)) {
      throw new ArtifactNotFoundError();
    }

    return resolvePrivateStoragePath(storage.jobDirectory(jobId), storageKey.slice(prefix.length));
  }

  function _outputFilePath(jobId: string, relativePath: string): string {
    return resolvePrivateStoragePath(storage.jobSubdirectory(jobId, 'output'), relativePath);
  }

  return { getArtifact, getResult };
}

function _outputArtifact(file: JobOutputFileEntry): ResultArtifact {
  return {
    category: file.category,
    contentType: file.contentType,
    displayName: file.relativePath,
    id: file.id,
    kind: 'OUTPUT',
    sizeBytes: file.sizeBytes,
    ...reportPolicy({ ...file, pipelineId: NEXTFLOW_PIPELINE_ID }),
  };
}

/**
 * Recommendation as stored for the job: rule, version, package, factors and disclaimer from
 * the `PackageRecommendation` row; the reason text from `result.json` (the row has none).
 */
function _storedRecommendation(
  row: {
    ruleIdentifier: string;
    ruleVersion: string;
    packageLabel: string;
    matchedFactors: string;
    disclaimer: string;
  },
  file: SmartCheckupResultFile,
): Recommendation {
  const factors = matchedFactorsSchema.safeParse(_parseJson(row.matchedFactors));
  const recommendation = recommendationSchema.safeParse({
    disclaimer: row.disclaimer,
    matched: row.ruleIdentifier !== NO_MOCK_RECOMMENDATION_RULE_ID,
    matchedFactors: factors.success ? factors.data : null,
    packageLabel: row.packageLabel,
    reason: file.recommendation.reason,
    ruleId: row.ruleIdentifier,
    ruleVersion: row.ruleVersion,
  });

  if (!recommendation.success) {
    throw new ResultCorruptError();
  }

  return recommendation.data;
}

/** A stored path outside the job directory is treated like an unknown artifact (`404`). */
function _confined(resolvePath: () => string): string {
  try {
    return resolvePath();
  } catch (error) {
    if (error instanceof StoragePathError || error instanceof ArtifactNotFoundError) {
      throw new ArtifactNotFoundError();
    }

    throw error;
  }
}

function _parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
