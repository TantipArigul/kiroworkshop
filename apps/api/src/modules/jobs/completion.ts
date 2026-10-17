import type { JobParameters } from '@portal/shared';

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
 * Port called by the executor before a job becomes COMPLETED (design C6). Throwing marks the
 * job FAILED, so a job is never reported as completed without its result.
 * Results & Guidance supplies its own handler that also creates artifacts and recommendations.
 */
export type JobCompletionHandler = (context: JobCompletionContext) => Promise<void>;

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
