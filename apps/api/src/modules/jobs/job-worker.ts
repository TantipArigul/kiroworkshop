import type { JobProgress, PipelineId } from '@portal/shared';

import type { PrismaClient } from '../../generated/prisma/client.js';
import type { ExecutionContext, ExecutorAdapter, ExecutorDirectory } from './executor.js';
import type { JobStorage } from './job-storage.js';
import { STATUS_SUMMARIES, type JobService, type TransitionOptions } from './job.service.js';

const BATCH_SIZE = 5;
const HEARTBEAT_TOLERANCE = 3;
const OUTPUT_FAILURE_SUMMARY =
  'The pipeline did not produce the expected results. Check the input and submit again.';

type WorkerLogger = {
  info: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
};

type JobWorkerOptions = {
  prisma: PrismaClient;
  jobs: JobService;
  storage: JobStorage;
  executors: ExecutorDirectory;
  /** Retention sweep run on its own interval inside the same loop (design C7). */
  sweep?: () => Promise<unknown>;
  config: {
    executorEnabled: boolean;
    executorPollIntervalMs: number;
    executorQueuedDelayMs: number;
    retentionSweepIntervalMs: number;
    shutdownTimeoutMs: number;
  };
  logger: WorkerLogger;
  clock?: () => number;
};

type RunningJob = { id: string; ownerId: string; pipelineId: string; updatedAt: Date };

export type JobWorker = ReturnType<typeof createJobWorker>;

/**
 * Local executor loop (Unit 2 C5, Pipeline Catalog C6): a DB-polling loop in the API process.
 * Each adapter starts at most `capacity` jobs, oldest first by `(createdAt, id)`. All state
 * lives in SQLite, so a restart loses only in-flight work, which `start()` marks FAILED instead
 * of leaving it RUNNING or inventing a COMPLETED result.
 */
export function createJobWorker(options: JobWorkerOptions) {
  const { clock = Date.now, config, executors, jobs, logger, prisma, storage } = options;
  let timer: NodeJS.Timeout | null = null;
  let current: Promise<void> | null = null;
  let lastHeartbeatAt = 0;
  let lastSweepAt = 0;
  let storageWritable = false;
  let stopped = false;
  const lastProgress = new Map<string, string>();

  async function processQueued(now: number, adapter: ExecutorAdapter, pipelineIds: string[]) {
    const running = await prisma.job.count({
      where: { pipelineId: { in: pipelineIds }, status: 'RUNNING' },
    });
    const free = Math.min(adapter.capacity - running, BATCH_SIZE);

    if (free <= 0) {
      return;
    }

    const ready = await prisma.job.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, ownerId: true, pipelineId: true },
      take: free,
      where: {
        createdAt: { lte: new Date(now - config.executorQueuedDelayMs) },
        pipelineId: { in: pipelineIds },
        status: 'QUEUED',
      },
    });

    for (const job of ready) {
      const summary =
        adapter.id === 'simulated' ? STATUS_SUMMARIES.RUNNING : STATUS_SUMMARIES.RUN_STARTED;

      if (!(await jobs.transition(job.id, 'QUEUED', 'RUNNING', summary, requestId()))) {
        continue;
      }

      logger.info({ jobId: job.id, from: 'QUEUED', to: 'RUNNING' }, 'Job transition');
      await startJob(adapter, contextOf(job));
    }
  }

  async function startJob(adapter: ExecutorAdapter, context: ExecutionContext) {
    try {
      await adapter.start(context);
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : 'unknown', jobId: context.jobId },
        'Job start failed',
      );
      await finish(adapter, context.jobId, 'FAILED', STATUS_SUMMARIES.START_FAILURE);
      return;
    }

    // A cancel or delete may have landed while the process was starting.
    const after = await prisma.job.findUnique({
      select: { status: true },
      where: { id: context.jobId },
    });

    if (after?.status !== 'RUNNING') {
      await adapter.cancel(context.jobId);
      await adapter.cleanup(context.jobId, after?.status === 'FAILED' ? 'FAILED' : 'CANCELLED');
    }
  }

  async function processRunning(now: number, adapter: ExecutorAdapter, pipelineIds: string[]) {
    // Jobs that became RUNNING in this pass (updatedAt after `now`) are polled next pass.
    const running: RunningJob[] = await prisma.job.findMany({
      orderBy: { updatedAt: 'asc' },
      select: { id: true, ownerId: true, pipelineId: true, updatedAt: true },
      take: Number.isFinite(adapter.capacity) ? Math.max(adapter.capacity, BATCH_SIZE) : BATCH_SIZE,
      where: {
        pipelineId: { in: pipelineIds },
        status: 'RUNNING',
        updatedAt: { lte: new Date(now) },
      },
    });

    for (const job of running) {
      const context = contextOf(job);
      let result: Awaited<ReturnType<ExecutorAdapter['poll']>>;

      try {
        result = await adapter.poll(context, job.updatedAt);
      } catch (error) {
        // One job's poll failure must not stop the others; it is retried next pass.
        logger.error(
          { errorType: error instanceof Error ? error.name : 'unknown', jobId: job.id },
          'Job poll failed',
        );
        continue;
      }

      if (result.state === 'running') {
        if (result.progress) {
          await saveProgress(job.id, result.progress);
        }

        continue;
      }

      if (result.state === 'failed') {
        await finish(adapter, job.id, 'FAILED', result.summary);
        continue;
      }

      const summary =
        adapter.id === 'simulated' ? STATUS_SUMMARIES.COMPLETED : STATUS_SUMMARIES.RUN_COMPLETED;

      try {
        await finish(adapter, job.id, 'COMPLETED', summary, result.finalize);
      } catch (error) {
        // `finalize` threw (e.g. a required output is missing): the transaction rolled back.
        logger.error(
          { errorType: error instanceof Error ? error.name : 'unknown', jobId: job.id },
          'Job finalization failed',
        );
        await finish(adapter, job.id, 'FAILED', OUTPUT_FAILURE_SUMMARY);
      }
    }
  }

  async function saveProgress(jobId: string, progress: JobProgress) {
    const serialized = JSON.stringify(progress);

    if (lastProgress.get(jobId) === serialized) {
      return;
    }

    await jobs.recordProgress(jobId, progress);
    lastProgress.set(jobId, serialized);
  }

  async function finish(
    adapter: ExecutorAdapter,
    jobId: string,
    to: 'COMPLETED' | 'FAILED',
    summary: string,
    finalize?: TransitionOptions['inTx'],
  ) {
    const applied = await jobs.transition(jobId, 'RUNNING', to, summary, requestId(), {
      inTx: finalize,
    });

    if (!applied) {
      return;
    }

    logger.info({ jobId, from: 'RUNNING', to }, 'Job transition');
    lastProgress.delete(jobId);
    await adapter.cleanup(jobId, to);
  }

  /** One executor pass. Safe to call directly from tests; never overlaps with itself. */
  async function tick(): Promise<void> {
    if (current) {
      return current;
    }

    current = (async () => {
      const now = clock();

      try {
        for (const { adapter, pipelineIds } of executors.entries) {
          await processQueued(now, adapter, [...pipelineIds]);
        }

        for (const { adapter, pipelineIds } of executors.entries) {
          await processRunning(now, adapter, [...pipelineIds]);
        }

        if (options.sweep && now - lastSweepAt >= config.retentionSweepIntervalMs) {
          lastSweepAt = now;
          await options.sweep();
        }

        lastHeartbeatAt = clock();
      } catch (error) {
        logger.error({ err: error }, 'Executor tick failed');
      } finally {
        current = null;
      }
    })();

    return current;
  }

  /** Fails jobs left RUNNING by a previous process, then starts the loop. */
  async function start(): Promise<void> {
    storageWritable = await storage.checkWritable();
    const stale = await prisma.job.findMany({
      select: { id: true, pipelineId: true },
      where: { status: 'RUNNING' },
    });

    for (const job of stale) {
      if (
        await jobs.transition(
          job.id,
          'RUNNING',
          'FAILED',
          STATUS_SUMMARIES.INTERRUPTED,
          requestId(),
        )
      ) {
        await executors
          .adapterFor(job.pipelineId)
          ?.cleanup(job.id, 'FAILED')
          .catch(() => undefined);
      }
    }

    if (stale.length > 0) {
      logger.info({ count: stale.length }, 'Reconciled interrupted jobs');
    }

    if (!config.executorEnabled) {
      return;
    }

    stopped = false;
    lastHeartbeatAt = clock();
    timer = setInterval(() => void tick(), config.executorPollIntervalMs);
    timer.unref();
  }

  /**
   * Stops polling, waits for the current pass so no transition is cut off mid-way, then stops
   * every adapter's running work within the shutdown timeout. Interrupted jobs stay RUNNING and
   * are marked FAILED (INTERRUPTED) by the next `start()`.
   */
  async function stop(): Promise<void> {
    stopped = true;

    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    await current;
    await Promise.all(
      executors.adapters().map((adapter) =>
        adapter.stopAll(config.shutdownTimeoutMs).catch((error: unknown) => {
          logger.error(
            { errorType: error instanceof Error ? error.name : 'unknown', executor: adapter.id },
            'Executor stop failed',
          );
        }),
      ),
    );
  }

  function isReady(): boolean {
    return (
      config.executorEnabled &&
      !stopped &&
      timer !== null &&
      storageWritable &&
      clock() - lastHeartbeatAt <= HEARTBEAT_TOLERANCE * config.executorPollIntervalMs
    );
  }

  return { isReady, start, stop, tick };
}

function contextOf(job: { id: string; ownerId: string; pipelineId: string }): ExecutionContext {
  return {
    jobId: job.id,
    ownerId: job.ownerId,
    pipelineId: job.pipelineId as PipelineId,
    requestId: requestId(),
  };
}

function requestId(): string {
  return `executor-${crypto.randomUUID()}`;
}
