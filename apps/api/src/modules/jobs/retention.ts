import type { PrismaClient } from '../../generated/prisma/client.js';
import type { AuditService } from '../audit/audit.service.js';
import type { JobStorage } from './job-storage.js';
import type { JobService } from './job.service.js';

const BATCH_SIZE = 100;
const MAX_BATCHES = 50;

export type SweepResult = { deleted: number; failed: number; orphansRemoved: number };

type SweepOptions = {
  prisma: PrismaClient;
  jobs: JobService;
  storage: JobStorage;
  audit: AuditService;
  logger: { error: (object: Record<string, unknown>, message: string) => void };
};

/**
 * Seven-day retention (design C7, US-014 AC2–3). Expired jobs are removed with the same policy
 * as an owner deletion; a failure is audited (visible to AUDIT_READ users) and the sweep moves
 * on. Directories without a job row — left by an interrupted deletion — are removed too.
 */
export function createRetentionSweeper({ audit, jobs, logger, prisma, storage }: SweepOptions) {
  return async function sweepExpiredJobs(
    input: { now?: Date; requestId?: string } = {},
  ): Promise<SweepResult> {
    const now = input.now ?? new Date();
    const requestId = input.requestId ?? `retention-${crypto.randomUUID()}`;
    const result: SweepResult = { deleted: 0, failed: 0, orphansRemoved: 0 };
    const failedIds = new Set<string>();

    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const expired = await prisma.job.findMany({
        orderBy: { expiresAt: 'asc' },
        select: { id: true },
        take: BATCH_SIZE,
        where: { expiresAt: { lt: now }, id: { notIn: [...failedIds] } },
      });

      if (expired.length === 0) {
        break;
      }

      for (const job of expired) {
        try {
          await jobs.remove({ actor: null, jobId: job.id, reason: 'RETENTION', requestId });
          result.deleted += 1;
        } catch (error) {
          failedIds.add(job.id);
          result.failed += 1;
          logger.error(
            { errorType: error instanceof Error ? error.name : 'unknown', jobId: job.id },
            'Retention deletion failed',
          );
          await audit.recordSafely({
            actorId: null,
            eventType: 'JOB_DELETED',
            metadata: { reason: 'RETENTION' },
            outcome: 'FAILURE',
            requestId,
            resourceId: job.id,
            resourceType: 'JOB',
          });
        }
      }
    }

    const onDisk = await storage.listJobIds();

    if (onDisk.length > 0) {
      const known = new Set(
        (await prisma.job.findMany({ select: { id: true }, where: { id: { in: onDisk } } })).map(
          (job) => job.id,
        ),
      );

      for (const jobId of onDisk.filter((id) => !known.has(id))) {
        try {
          await storage.removeJob(jobId);
          result.orphansRemoved += 1;
        } catch (error) {
          logger.error(
            { errorType: error instanceof Error ? error.name : 'unknown', jobId },
            'Orphaned job storage removal failed',
          );
        }
      }
    }

    return result;
  };
}
