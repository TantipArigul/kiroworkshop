import type { JobProgress, PipelineId } from '@portal/shared';

import type { Prisma } from '../../generated/prisma/client.js';

export type TransactionClient = Prisma.TransactionClient;

export type ExecutionContext = {
  jobId: string;
  ownerId: string;
  pipelineId: PipelineId;
  requestId: string;
};

export type PollResult =
  | { state: 'running'; progress?: JobProgress }
  | { state: 'succeeded'; finalize?: (tx: TransactionClient) => Promise<void> }
  | { state: 'failed'; summary: string };

export type ExecutorOutcome = 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * Executor port (design C6, D3-4). The worker owns the Job status machine; an adapter only
 * starts, observes, stops and cleans up the work of one Job.
 */
export type ExecutorAdapter = {
  id: 'simulated' | 'nextflow';
  /** Maximum RUNNING jobs of this adapter (`Infinity` for the simulated executor). */
  capacity: number;
  isReady(): boolean;
  start(context: ExecutionContext): Promise<void>;
  poll(context: ExecutionContext, runningSince: Date): Promise<PollResult>;
  /** Stops the work of a job; idempotent and safe when nothing is running. */
  cancel(jobId: string): Promise<void>;
  cleanup(jobId: string, outcome: ExecutorOutcome): Promise<void>;
  stopAll(timeoutMs: number): Promise<void>;
};

export type ExecutorDirectory = ReturnType<typeof createExecutorDirectory>;

/** Maps pipeline IDs to the adapter that executes them (one adapter may serve many). */
export function createExecutorDirectory(
  entries: readonly { adapter: ExecutorAdapter; pipelineIds: readonly string[] }[],
) {
  const byPipeline = new Map<string, ExecutorAdapter>();

  for (const entry of entries) {
    for (const pipelineId of entry.pipelineIds) {
      byPipeline.set(pipelineId, entry.adapter);
    }
  }

  return {
    entries,
    adapterFor(pipelineId: string): ExecutorAdapter | null {
      return byPipeline.get(pipelineId) ?? null;
    },
    adapters(): ExecutorAdapter[] {
      return entries.map((entry) => entry.adapter);
    },
  };
}
