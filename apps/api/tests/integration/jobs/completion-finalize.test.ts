import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  writeResultSummary,
  type JobCompletionHandler,
} from '../../../src/modules/jobs/completion.js';
import {
  createJobsTestContext,
  SAMPLE_BODY,
  type JobsTestContext,
} from '../../support/jobs-context.js';

// Port change for Results & Guidance (design C3): a completion handler may return `finalize`,
// which the simulated adapter passes on so the worker runs it in the COMPLETED transaction.
const scenario = { finalizeThrows: false };
const handler: JobCompletionHandler = async (completion) => {
  await writeResultSummary(completion);

  return {
    finalize: async (tx) => {
      await tx.packageRecommendation.create({
        data: {
          disclaimer: 'Training output only.',
          jobId: completion.jobId,
          matchedFactors: '[]',
          packageLabel: 'No mock recommendation',
          ruleIdentifier: 'NO_MATCH',
          ruleVersion: 'test',
        },
      });

      if (scenario.finalizeThrows) {
        throw new Error('finalize exploded with /secret/path');
      }
    },
  };
};

let context: JobsTestContext;
let session: Awaited<ReturnType<JobsTestContext['signIn']>>;

async function runJob(): Promise<string> {
  const { body } = await session.post('/api/v1/jobs', SAMPLE_BODY, {
    'Idempotency-Key': crypto.randomUUID(),
  });

  for (let pass = 0; pass < 3; pass += 1) {
    await context.tick();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  return body.data.job.id as string;
}

beforeAll(async () => {
  context = await createJobsTestContext({ completionHandler: handler });
  session = await context.signIn('finalize@example.test');
});

afterAll(async () => {
  await context.cleanup();
});

describe('JobCompletionHandler.finalize (Results & Guidance port)', () => {
  it('creates the finalize rows in the same transaction that makes the job COMPLETED', async () => {
    scenario.finalizeThrows = false;
    const jobId = await runJob();

    const job = await context.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('COMPLETED');
    expect(await context.prisma.packageRecommendation.count({ where: { jobId } })).toBe(1);
  });

  it('rolls the rows back and marks the job FAILED when finalize throws', async () => {
    scenario.finalizeThrows = true;
    const jobId = await runJob();

    const detail = await session.get(`/api/v1/jobs/${jobId}`);
    expect(detail.body.data.status).toBe('FAILED');
    expect(JSON.stringify(detail.body)).not.toContain('/secret/path');
    expect(await context.prisma.packageRecommendation.count({ where: { jobId } })).toBe(0);
  });
});
