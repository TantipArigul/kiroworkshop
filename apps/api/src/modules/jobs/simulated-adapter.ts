import type { PrismaClient } from '../../generated/prisma/client.js';
import type { JobCompletionHandler } from './completion.js';
import type { ExecutionContext, ExecutorAdapter, PollResult } from './executor.js';
import type { JobStorage } from './job-storage.js';
import { readInputRows, readParameters, STATUS_SUMMARIES } from './job.service.js';

type SimulatedAdapterOptions = {
  prisma: PrismaClient;
  storage: JobStorage;
  completionHandler: JobCompletionHandler;
  config: { executorRunningDelayMs: number };
  logger: { error: (object: Record<string, unknown>, message: string) => void };
  clock?: () => number;
};

/**
 * Smart Checkup's simulated executor (Unit 2 behaviour, unchanged): a job stays RUNNING for
 * `EXECUTOR_RUNNING_DELAY_MS`, then either fails on request (`simulateFailure`) or runs the
 * completion handler, which must succeed before the job may become COMPLETED.
 */
export function createSimulatedAdapter(options: SimulatedAdapterOptions): ExecutorAdapter {
  const { clock = Date.now, completionHandler, config, logger, prisma, storage } = options;

  async function poll(context: ExecutionContext, runningSince: Date): Promise<PollResult> {
    if (clock() - runningSince.getTime() < config.executorRunningDelayMs) {
      return { state: 'running' };
    }

    const input = await prisma.jobInput.findUnique({
      select: { parametersJson: true },
      where: { jobId: context.jobId },
    });
    const parameters = readParameters(input?.parametersJson);

    if (parameters.simulateFailure) {
      return { state: 'failed', summary: STATUS_SUMMARIES.SIMULATED_FAILURE };
    }

    try {
      const rows = readInputRows(await storage.readInput(context.jobId));

      if (rows.length === 0) {
        throw new Error('Stored input could not be read.');
      }

      await completionHandler({
        jobId: context.jobId,
        ownerId: context.ownerId,
        parameters,
        requestId: context.requestId,
        rows,
        storage,
      });

      return { state: 'succeeded' };
    } catch (error) {
      // Only the error type is logged: never input values or storage paths.
      logger.error(
        { errorType: error instanceof Error ? error.name : 'unknown', jobId: context.jobId },
        'Job completion handler failed',
      );

      return { state: 'failed', summary: STATUS_SUMMARIES.HANDLER_FAILURE };
    }
  }

  return {
    capacity: Number.POSITIVE_INFINITY,
    id: 'simulated',
    isReady: () => true,
    poll,
    // The simulated executor holds no process or files beyond the job directory.
    start: async () => undefined,
    cancel: async () => undefined,
    cleanup: async () => undefined,
    stopAll: async () => undefined,
  };
}
