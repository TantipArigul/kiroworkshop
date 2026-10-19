import type { ResultArtifactCategory } from '@portal/shared';

/** Structural subset of the pino logger used by the results module. */
export type ResultsLogger = {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
};

/** Used when no logger is wired (tests or callers that do not need operational events). */
export const NOOP_RESULTS_LOGGER: ResultsLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

/**
 * Operational log events of design "Operations" (C3–C6). Every event takes a fixed set of
 * identifier fields only, so file names, sample aliases, storage paths, marker values and report
 * content can never be added to a log line by accident.
 */
export const resultsLog = {
  /** C3 — the result file and rows were created for a Smart Checkup job. */
  generated(logger: ResultsLogger, fields: { jobId: string; ruleId: string; ruleVersion: string }) {
    logger.info(
      { jobId: fields.jobId, ruleId: fields.ruleId, ruleVersion: fields.ruleVersion },
      'Result generated',
    );
  },
  /** C3 — the result could not be generated (the job becomes FAILED); error type only. */
  generationFailed(logger: ResultsLogger, fields: { jobId: string; error: unknown }) {
    logger.error(
      { errorType: _errorType(fields.error), jobId: fields.jobId },
      'Result generation failed',
    );
  },
  /** C4/C5 — a COMPLETED job's result is missing (`410`) or invalid (`410`/`500`). */
  unavailable(logger: ResultsLogger, fields: { jobId: string; reason: 'MISSING' | 'INVALID' }) {
    logger.warn({ jobId: fields.jobId, reason: fields.reason }, 'Result unavailable');
  },
  /** C6 — a download or view response was streamed completely. */
  served(
    logger: ResultsLogger,
    fields: {
      jobId: string;
      artifactId: string;
      category: ResultArtifactCategory;
      mode: 'download' | 'view';
      bytes: number;
    },
  ) {
    logger.info(
      {
        artifactId: fields.artifactId,
        bytes: fields.bytes,
        category: fields.category,
        jobId: fields.jobId,
        mode: fields.mode,
      },
      'Artifact served',
    );
  },
  /** C6 — the artifact row exists but its file is gone (`410`). */
  missing(logger: ResultsLogger, fields: { jobId: string; artifactId: string }) {
    logger.warn({ artifactId: fields.artifactId, jobId: fields.jobId }, 'Artifact missing');
  },
};

/** Error class name only: messages of file-system errors carry absolute storage paths. */
function _errorType(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
