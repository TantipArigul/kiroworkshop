import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { jobDetailSchema, jobListSchema, jobSubmitResponseSchema } from '@portal/shared';

import { createRetentionSweeper } from '../../../src/modules/jobs/retention.js';
import { createSession } from '../../support/http-session.js';
import {
  createJobsTestContext,
  SAMPLE_BODY,
  type JobsTestContext,
} from '../../support/jobs-context.js';

let context: JobsTestContext;
let owner: Awaited<ReturnType<JobsTestContext['signIn']>>;
let other: Awaited<ReturnType<JobsTestContext['signIn']>>;

const key = () => ({ 'Idempotency-Key': crypto.randomUUID() });

async function submit(session: typeof owner, body: object = SAMPLE_BODY, headers = key()) {
  return session.post('/api/v1/jobs', body, headers);
}

async function settle() {
  for (let pass = 0; pass < 3; pass += 1) {
    await context.tick();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function auditRows(eventType: string, resourceId?: string) {
  return context.prisma.auditEvent.findMany({
    orderBy: { occurredAt: 'asc' },
    where: { eventType, ...(resourceId ? { resourceId } : {}) },
  });
}

beforeAll(async () => {
  context = await createJobsTestContext();
  owner = await context.signIn('owner@example.test');
  other = await context.signIn('other@example.test');
});

afterAll(async () => {
  await context.cleanup();
});

beforeEach(() => {
  context.executor.ready = true;
  expect.hasAssertions();
});

describe('authentication boundary', () => {
  it('requires a session for every jobs route', async () => {
    const anonymous = createSession(context.app);

    for (const path of ['/api/v1/jobs', '/api/v1/jobs/sample-input']) {
      const response = await anonymous.get(path);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    }
  });

  it('rejects submissions without a CSRF token', async () => {
    const response = await owner.agent.post('/api/v1/jobs').set(key()).send(SAMPLE_BODY);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_INVALID');
  });
});

describe('GET /api/v1/jobs/sample-input (US-003)', () => {
  it('returns the authored synthetic sample and the format rules', async () => {
    const response = await owner.get('/api/v1/jobs/sample-input');

    expect(response.status).toBe(200);
    expect(response.body.data.file.content.startsWith('marker,value,unit')).toBe(true);
    expect(response.body.data.format.markers).toHaveLength(10);
    expect(await context.prisma.job.count()).toBe(0);
  });
});

describe('POST /api/v1/jobs (US-004, US-005, US-008)', () => {
  it('creates a QUEUED job with an event, audit record and stored input', async () => {
    const response = await submit(owner);

    expect(response.status).toBe(201);
    expect(jobSubmitResponseSchema.safeParse(response.body.data).success).toBe(true);
    const { job, statusUrl } = response.body.data;
    expect(job.status).toBe('QUEUED');
    expect(statusUrl).toBe(`/jobs/${job.id}`);

    const stored = await context.prisma.job.findUniqueOrThrow({
      include: { input: true, statusEvents: true },
      where: { id: job.id },
    });
    expect(stored.ownerId).toBe(owner.userId);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(7 * 86_400_000);
    expect(stored.input?.storageKey).toBe(`jobs/${job.id}/input.csv`);
    expect(stored.statusEvents.map((event) => event.status)).toEqual(['QUEUED']);
    expect(
      await readFile(join(context.config.storageRoot, 'jobs', job.id, 'input.csv'), 'utf8'),
    ).toBe(SAMPLE_BODY.file.content);

    const [submitted] = await auditRows('JOB_SUBMITTED', job.id);
    expect(submitted).toMatchObject({ actorId: owner.userId, outcome: 'SUCCESS' });
    expect(submitted?.metadataJson).toBe('{"status":"QUEUED"}');
  });

  it('replays the same job for a repeated Idempotency-Key', async () => {
    const headers = key();
    const first = await submit(owner, SAMPLE_BODY, headers);
    const second = await submit(owner, SAMPLE_BODY, headers);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.job.id).toBe(first.body.data.job.id);
    expect(
      await context.prisma.job.count({ where: { idempotencyKey: headers['Idempotency-Key'] } }),
    ).toBe(1);
  });

  it('requires a UUID Idempotency-Key', async () => {
    const before = await context.prisma.job.count();
    const response = await owner.post('/api/v1/jobs', SAMPLE_BODY, {
      'Idempotency-Key': 'retry-1',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('Idempotency-Key');
    expect(await context.prisma.job.count()).toBe(before);
  });

  it('rejects invalid parameters and files without creating a job or file', async () => {
    const before = await context.prisma.job.count();
    const badParameters = await submit(owner, {
      ...SAMPLE_BODY,
      parameters: { ...SAMPLE_BODY.parameters, ageBand: '10-17', patientName: 'x' },
    });
    const badFile = await submit(owner, {
      ...SAMPLE_BODY,
      file: { name: 'input.csv', content: 'marker,value,unit\nbmi,999,kg/m2\n' },
    });

    expect(badParameters.status).toBe(400);
    expect(
      badParameters.body.error.details.map((detail: { field: string }) => detail.field),
    ).toEqual(expect.arrayContaining(['parameters.ageBand']));
    expect(badFile.status).toBe(400);
    expect(badFile.body.error.details[0]).toEqual({
      field: 'file.line 2',
      message: 'Line 2: The value must be between 10 and 70.',
    });
    // Only the error must not echo the input; `meta.requestId` is a random UUID that can
    // legitimately contain "999" (was a ~1% flake when the whole body was checked).
    expect(JSON.stringify(badFile.body.error)).not.toContain('999');
    expect(await context.prisma.job.count()).toBe(before);
  });

  it('rejects path-like file names and records a redacted security event', async () => {
    const before = await context.prisma.job.count();
    const response = await submit(owner, {
      ...SAMPLE_BODY,
      file: { ...SAMPLE_BODY.file, name: '../../etc/passwd.csv' },
    });

    expect(response.status).toBe(400);
    expect(await context.prisma.job.count()).toBe(before);
    const [event] = (await auditRows('JOB_INPUT_REJECTED')).slice(-1);
    expect(event).toMatchObject({ actorId: owner.userId, outcome: 'DENIED' });
    expect(event?.metadataJson).toBe('{"reason":"UNSAFE_FILENAME"}');
  });

  it('refuses submissions while the executor is not ready', async () => {
    context.executor.ready = false;
    const before = await context.prisma.job.count();
    const response = await submit(owner);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(await context.prisma.job.count()).toBe(before);
  });
});

describe('GET /api/v1/jobs and /api/v1/jobs/:jobId (US-006, US-007, US-002)', () => {
  it('lists only the owner’s jobs, newest activity first', async () => {
    const mine = await owner.get('/api/v1/jobs');
    const theirs = await other.get('/api/v1/jobs');

    expect(mine.status).toBe(200);
    expect(jobListSchema.safeParse(mine.body.data).success).toBe(true);
    expect(mine.body.data.total).toBeGreaterThan(0);
    expect(theirs.body.data).toEqual({ items: [], limit: 20, page: 1, total: 0 });
    const updated = mine.body.data.items.map((job: { updatedAt: string }) =>
      Date.parse(job.updatedAt),
    );
    expect(updated).toEqual([...updated].sort((a, b) => b - a));
  });

  it('returns the same 404 for foreign, missing and malformed job IDs and audits the denial', async () => {
    const { body } = await submit(owner);
    const jobId = body.data.job.id as string;
    const foreign = await other.get(`/api/v1/jobs/${jobId}`);
    const missing = await other.get('/api/v1/jobs/cmissing00000000000000000');
    const malformed = await other.get('/api/v1/jobs/..%2F..%2Fetc');

    for (const response of [foreign, missing, malformed]) {
      expect(response.status).toBe(404);
      expect(response.body.error).toEqual({
        code: 'NOT_FOUND',
        details: [],
        message: 'This job is unavailable.',
      });
    }

    const denials = await auditRows('AUTHORIZATION_DENIED', jobId);
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({ actorId: other.userId, resourceType: 'JOB' });
    expect((await other.delete(`/api/v1/jobs/${jobId}`)).status).toBe(404);
    expect(await context.prisma.job.count({ where: { id: jobId } })).toBe(1);
  });

  it('runs QUEUED → RUNNING → COMPLETED with history, result file and audit trail', async () => {
    const { body } = await submit(owner);
    const jobId = body.data.job.id as string;

    await settle();
    const detail = await owner.get(`/api/v1/jobs/${jobId}`);

    expect(detail.status).toBe(200);
    expect(jobDetailSchema.safeParse(detail.body.data).success).toBe(true);
    expect(detail.body.data.status).toBe('COMPLETED');
    expect(detail.body.data.history.map((item: { status: string }) => item.status)).toEqual([
      'QUEUED',
      'RUNNING',
      'COMPLETED',
    ]);
    expect(detail.body.data.failureSummary).toBeNull();
    expect(detail.body.data.file).toEqual({
      name: 'smart-checkup-sample.csv',
      rowCount: 10,
      sizeBytes: Buffer.byteLength(SAMPLE_BODY.file.content),
    });
    const result = JSON.parse(
      await readFile(join(context.config.storageRoot, 'jobs', jobId, 'result.json'), 'utf8'),
    );
    expect(result.markers).toHaveLength(10);
    expect(result.parameters).not.toHaveProperty('simulateFailure');
    // Default completion handler is the Results & Guidance builder (result.json v2 + rows).
    expect(result.schemaVersion).toBe(2);
    expect(await context.prisma.resultArtifact.count({ where: { jobId } })).toBe(1);
    expect(await context.prisma.packageRecommendation.count({ where: { jobId } })).toBe(1);
    const transitions = (await auditRows('JOB_STATUS_CHANGED', jobId)).map(
      (row) => row.metadataJson,
    );
    expect(transitions).toEqual([
      '{"from":"QUEUED","to":"RUNNING"}',
      '{"from":"RUNNING","to":"COMPLETED"}',
    ]);
  });

  it('marks a simulated failure FAILED with a safe summary and no result file', async () => {
    const { body } = await submit(owner, {
      ...SAMPLE_BODY,
      parameters: { ...SAMPLE_BODY.parameters, simulateFailure: true },
    });
    const jobId = body.data.job.id as string;

    await settle();
    const detail = await owner.get(`/api/v1/jobs/${jobId}`);

    expect(detail.body.data.status).toBe('FAILED');
    expect(detail.body.data.failureSummary).toMatch(/^Simulated pipeline failure/);
    expect(context.jobDirectoryExists(jobId)).toBe(true);
    await expect(
      readFile(join(context.config.storageRoot, 'jobs', jobId, 'result.json'), 'utf8'),
    ).rejects.toThrow();
  });
});

describe('completion handler failures and restart reconciliation (US-008, NFR-002)', () => {
  let failing: JobsTestContext;

  beforeAll(async () => {
    failing = await createJobsTestContext({
      completionHandler: async () => {
        throw new Error('handler exploded with /secret/path');
      },
    });
  });

  afterAll(async () => {
    await failing.cleanup();
  });

  it('never reports COMPLETED when the completion handler fails', async () => {
    const session = await failing.signIn('handler@example.test');
    const { body } = await session.post('/api/v1/jobs', SAMPLE_BODY, key());

    for (let pass = 0; pass < 3; pass += 1) {
      await failing.tick();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const detail = await session.get(`/api/v1/jobs/${body.data.job.id}`);
    expect(detail.body.data.status).toBe('FAILED');
    expect(detail.body.data.failureSummary).toBe(
      'The analysis could not produce a result. Please submit the job again.',
    );
    expect(JSON.stringify(detail.body)).not.toContain('/secret/path');
  });

  it('fails jobs left RUNNING by a previous process on start', async () => {
    const session = await failing.signIn('restart@example.test');
    const { body } = await session.post('/api/v1/jobs', SAMPLE_BODY, key());
    const jobId = body.data.job.id as string;
    await failing.prisma.job.update({ data: { status: 'RUNNING' }, where: { id: jobId } });

    const { getJobWorker } = await import('../../../src/http/app.js');
    await getJobWorker(failing.app).start();

    const detail = await session.get(`/api/v1/jobs/${jobId}`);
    expect(detail.body.data.status).toBe('FAILED');
    expect(detail.body.data.failureSummary).toMatch(/interrupted by a service restart/);
  });
});

describe('DELETE /api/v1/jobs/:jobId and retention (US-014)', () => {
  it('deletes the job, its children and directory; the URL then returns 404', async () => {
    const { body } = await submit(owner);
    const jobId = body.data.job.id as string;
    await settle();

    const response = await owner.delete(`/api/v1/jobs/${jobId}`);

    expect(response.status).toBe(204);
    expect(await context.prisma.job.count({ where: { id: jobId } })).toBe(0);
    expect(await context.prisma.jobInput.count({ where: { jobId } })).toBe(0);
    expect(await context.prisma.jobStatusEvent.count({ where: { jobId } })).toBe(0);
    expect(context.jobDirectoryExists(jobId)).toBe(false);
    expect((await owner.get(`/api/v1/jobs/${jobId}`)).status).toBe(404);
    const [deleted] = await auditRows('JOB_DELETED', jobId);
    expect(deleted).toMatchObject({ actorId: owner.userId, outcome: 'SUCCESS' });
    expect(deleted?.metadataJson).toBe('{"reason":"OWNER_REQUEST"}');
  });

  it('sweeps only expired jobs and removes orphaned directories', async () => {
    const expired = (await submit(owner)).body.data.job.id as string;
    const fresh = (await submit(owner)).body.data.job.id as string;
    await context.prisma.job.update({
      data: { expiresAt: new Date(Date.now() - 1000) },
      where: { id: expired },
    });
    const { createJobStorage } = await import('../../../src/modules/jobs/job-storage.js');
    const storage = createJobStorage(context.config.storageRoot);
    await storage.writeInput('corphan000000000000000000', 'left behind');

    const { createAuditService } = await import('../../../src/modules/audit/audit.service.js');
    const { createJobService } = await import('../../../src/modules/jobs/job.service.js');
    const audit = createAuditService(context.prisma, { error: () => undefined });
    const logger = { error: () => undefined };
    const jobs = createJobService({
      audit,
      config: context.config,
      isExecutorReady: () => true,
      logger,
      prisma: context.prisma,
      storage,
    });
    const result = await createRetentionSweeper({
      audit,
      jobs,
      logger,
      prisma: context.prisma,
      storage,
    })();

    expect(result).toEqual({ deleted: 1, failed: 0, orphansRemoved: 1 });
    expect(await context.prisma.job.count({ where: { id: expired } })).toBe(0);
    expect(await context.prisma.job.count({ where: { id: fresh } })).toBe(1);
    expect(context.jobDirectoryExists(expired)).toBe(false);
    expect(context.jobDirectoryExists('corphan000000000000000000')).toBe(false);
    const [retention] = await auditRows('JOB_DELETED', expired);
    expect(retention).toMatchObject({ actorId: null, outcome: 'SUCCESS' });
    expect(retention?.metadataJson).toBe('{"reason":"RETENTION"}');
  });
});

describe('readiness reports the executor', () => {
  it('returns 503 with executor failed when the executor is not ready', async () => {
    context.executor.ready = false;
    const response = await createSession(context.app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.data.checks).toEqual({ database: 'ok', executor: 'failed' });
  });
});
