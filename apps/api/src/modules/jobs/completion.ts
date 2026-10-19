import type { JobParameters } from '@portal/shared';

import type { TransactionClient } from './executor.js';
import type { InputRow } from './input-validator.js';
import type { JobStorage } from './job-storage.js';

export type JobCompletionContext = {
  jobId: string;
  ownerId: string;
  parameters: JobParameters;
  rows: InputRow[];
  storage: JobStorage;
  requestId: string;
};

/**
 * Optional second step of a completion handler: runs inside the RUNNING → COMPLETED
 * transaction, so rows it creates exist if and only if the job becomes COMPLETED.
 */
export type JobCompletionFinalizer = {
  finalize(tx: TransactionClient): Promise<void>;
};

/**
 * Port called by the executor before a job becomes COMPLETED (design C6). Throwing — from the
 * handler or from its `finalize` — marks the job FAILED, so a job is never reported as
 * completed without its result. Handlers that only write files return nothing; Results &
 * Guidance returns a `finalize` step that creates artifact and recommendation rows.
 */
export type JobCompletionHandler = (
  context: JobCompletionContext,
) => Promise<void | JobCompletionFinalizer>;

/** Default handler: writes a structured `result.json` summary of the validated input. */
export const writeResultSummary: JobCompletionHandler = async ({
  jobId,
  parameters,
  rows,
  storage,
}) => {
  const { simulateFailure: _ignored, ...publicParameters } = parameters;
  void _ignored;

  await storage.writeResult(
    jobId,
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        parameters: publicParameters,
        markers: rows,
      },
      null,
      2,
    ),
  );
};
