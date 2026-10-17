import type { PrismaClient } from '../../generated/prisma/client.js';
import type { JobCompletionHandler } from './completion.js';
import type { JobStorage } from './job-storage.js';
import { readInputRows, readParameters, STATUS_SUMMARIES, type JobService } from './job.service.js';

const BATCH_SIZE = 5;
const HEARTBEAT_TOLERANCE = 3;

type WorkerLogger = {
  info: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
};

type JobWorkerOptions = {
  prisma: PrismaClient;
  jobs: JobService;
  storage: JobStorage;
  completionHandler: JobCompletionHandler;
  /** Retention sweep run on its own interval inside the same loop (design C7). */
  sweep?: () => Promise<unknown>;
  config: {
    executorEnabled: boolean;
    executorPollIntervalMs: number;
    executorQueuedDelayMs: number;
    executorRunningDelayMs: number;
    retentionSweepIntervalMs: number;
  };
  logger: WorkerLogger;
  clock?: () => number;
};

export type JobWorker = ReturnType<typeof createJobWorker>;

/**
 * Simulated local executor (design C5): a DB-polling loop in the API process with no outbound
 * calls. All state lives in SQLite, so a restart loses nothing except in-flight work, which
 * `start()` marks FAILED instead of leaving it RUNNING or inventing a COMPLETED result.
 */
export function createJobWorker(options: JobWorkerOptions) {
  const { clock = Date.now, config, jobs, logger, prisma, storage } = options;
  let timer: NodeJS.Timeout | null = null;
  let current: Promise<void> | null = null;
  let lastHeartbeatAt = 0;
  let lastSweepAt = 0;
  let storageWritable = false;
  let stopped = false;

  async function processQueued(now: number) {
    const ready = await prisma.job.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      take: BATCH_SIZE,
      where: { createdAt: { lte: new Date(now - config.executorQueuedDelayMs) }, status: 'QUEUED' },
    });

    for (const job of ready) {
      if (
        await jobs.transition(job.id, 'QUEUED', 'RUNNING', STATUS_SUMMARIES.RUNNING, requestId())
      ) {
        logger.info({ jobId: job.id, from: 'QUEUED', to: 'RUNNING' }, 'Job transition');
      }
    }
  }

  async function processRunning(now: number) {
    const running = await prisma.job.findMany({
      include: { input: { select: { parametersJson: true } } },
      orderBy: { updatedAt: 'asc' },
      take: BATCH_SIZE,
      where: {
        status: 'RUNNING',
        updatedAt: { lte: new Date(now - config.executorRunningDelayMs) },
      },
    });

    for (const job of running) {
      const parameters = readParameters(job.input?.parametersJson);

      if (parameters.simulateFailure) {
        await finish(job.id, 'FAILED', STATUS_SUMMARIES.SIMULATED_FAILURE);
        continue;
      }

      try {
        const rows = readInputRows(await storage.readInput(job.id));

        if (rows.length === 0) {
          throw new Error('Stored input could not be read.');
        }

        await options.completionHandler({
          jobId: job.id,
          ownerId: job.ownerId,
          parameters,
          requestId: requestId(),
          rows,
          storage,
        });
        await finish(job.id, 'COMPLETED', STATUS_SUMMARIES.COMPLETED);
      } catch (error) {
        // Only the error type is logged: never input values or storage paths.
        logger.error(
          { errorType: error instanceof Error ? error.name : 'unknown', jobId: job.id },
          'Job completion handler failed',
        );
        await finish(job.id, 'FAILED', STATUS_SUMMARIES.HANDLER_FAILURE);
      }
    }
  }

  async function finish(jobId: string, to: 'COMPLETED' | 'FAILED', summary: string) {
    if (await jobs.transition(jobId, 'RUNNING', to, summary, requestId())) {
      logger.info({ jobId, from: 'RUNNING', to }, 'Job transition');
    }
  }

  /** One executor pass. Safe to call directly from tests; never overlaps with itself. */
  async function tick(): Promise<void> {
    if (current) {
      return current;
    }

    current = (async () => {
      const now = clock();

      try {
        await processQueued(now);
        await processRunning(now);

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
    const stale = await prisma.job.findMany({ select: { id: true }, where: { status: 'RUNNING' } });

    for (const job of stale) {
      await jobs.transition(job.id, 'RUNNING', 'FAILED', STATUS_SUMMARIES.INTERRUPTED, requestId());
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

  /** Stops polling and waits for the current pass so no transition is cut off mid-way. */
  async function stop(): Promise<void> {
    stopped = true;

    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    await current;
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

function requestId(): string {
  return `executor-${crypto.randomUUID()}`;
}
