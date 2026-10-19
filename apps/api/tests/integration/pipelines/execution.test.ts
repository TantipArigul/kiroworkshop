import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { jobDetailSchema } from '@portal/shared';

import { createAuditService } from '../../../src/modules/audit/audit.service.js';
import { createJobService } from '../../../src/modules/jobs/job.service.js';
import { createRetentionSweeper } from '../../../src/modules/jobs/retention.js';
import { RENAMEFASTQ_PARAM_KEYS } from '../../../src/modules/pipelines/registry.js';
import {
  createPipelinesTestContext,
  eventually,
  type PipelinesTestContext,
  type TestSession,
} from '../../support/pipelines-context.js';

let context: PipelinesTestContext;
let owner: TestSession;

beforeAll(async () => {
  context = await createPipelinesTestContext();
  owner = await context.signIn('runner@example.test');
  expect((await context.waitForReadiness(owner)).available).toBe(true);
});

afterEach(async () => {
  // Capacity is 1: never leave a run active for the next test.
  const active = await context.prisma.job.findMany({
    select: { id: true },
    where: { status: { in: ['QUEUED', 'RUNNING'] } },
  });

  for (const job of active) {
    await owner.post(`/api/v1/jobs/${job.id}/cancel`);
    await eventually(() => !context.processAlive(job.id));
  }
});

afterAll(async () => {
  await context.cleanup();
});

async function launchSingle(sampleName = 'sample01') {
  const response = await context.launch(owner, {
    files: ['reads.fastq.gz'],
    layout: 'SINGLE_FILE',
    sampleName,
  });
  expect(response.status).toBe(201);
  return response.body.data.job.id as string;
}

const runDirectory = (jobId: string) => context.storage.jobSubdirectory(jobId, 'run');
const outputDirectory = (jobId: string) => context.storage.jobSubdirectory(jobId, 'output');

describe('successful run (US-019, US-020, US-009/011 contract)', () => {
  it('completes, records JobOutputFile rows and removes work/ and .nextflow/', async () => {
    const jobId = await launchSingle();
    await context.setScenario(jobId, 'success', 150);

    expect(await context.waitForStatus(jobId, ['COMPLETED', 'FAILED'])).toBe('COMPLETED');

    const outputs = await context.prisma.jobOutputFile.findMany({
      orderBy: { relativePath: 'asc' },
      where: { jobId },
    });
    expect(outputs.map((row) => [row.relativePath, row.category, row.contentType])).toEqual([
      ['fastq/sample01.fastq.gz', 'READS', 'application/gzip'],
      ['stats/all_fastq_statistics.tsv', 'STATS', 'text/tab-separated-values'],
    ]);
    expect(existsSync(join(runDirectory(jobId), 'work'))).toBe(false);
    expect(existsSync(join(runDirectory(jobId), '.nextflow'))).toBe(false);
    expect(existsSync(join(outputDirectory(jobId), 'fastq', 'sample01.fastq.gz'))).toBe(true);
    expect(existsSync(join(runDirectory(jobId), 'trace.txt'))).toBe(true);

    const detail = await owner.get(`/api/v1/jobs/${jobId}`);
    expect(() => jobDetailSchema.parse(detail.body.data)).not.toThrow();
    expect(detail.body.data).toMatchObject({
      cancellable: false,
      failureSummary: null,
      outputs: { fileCount: 2 },
      progress: null,
      queuePosition: null,
      status: 'COMPLETED',
    });
    expect(detail.body.data.history.map((item: { status: string }) => item.status)).toEqual([
      'QUEUED',
      'RUNNING',
      'COMPLETED',
    ]);
  });

  it('writes params.json from the 14-key allowlist and starts the child offline without secrets', async () => {
    const jobId = await launchSingle('sample02');
    await context.setScenario(jobId, 'success', 50);
    expect(await context.waitForStatus(jobId, ['COMPLETED', 'FAILED'])).toBe('COMPLETED');

    const params = JSON.parse(
      await readFile(join(runDirectory(jobId), 'params.json'), 'utf8'),
    ) as Record<string, unknown>;
    const envKeys = (await readFile(join(runDirectory(jobId), 'env-keys.txt'), 'utf8'))
      .split('\n')
      .filter(Boolean);

    expect(
      Object.keys(params).every((key) =>
        (RENAMEFASTQ_PARAM_KEYS as readonly string[]).includes(key),
      ),
    ).toBe(true);
    expect(params).toMatchObject({
      custom_config_base: join(runDirectory(jobId), 'no-custom-config'),
      fastq: join(context.storage.jobSubdirectory(jobId, 'input'), 'fastq', 'reads.fastq.gz'),
      outdir: outputDirectory(jobId),
      sample: 'sample02',
    });
    expect(existsSync(String(params.custom_config_base))).toBe(false);
    expect(envKeys).toEqual(expect.arrayContaining(['NXF_OFFLINE', 'NXF_SYNTAX_PARSER', 'PATH']));

    for (const forbidden of ['SESSION_SECRET', 'DATABASE_URL', 'STORAGE_ROOT', 'NODE_ENV']) {
      expect(envKeys).not.toContain(forbidden);
    }
  });

  it('reports progress (completed steps, current step) only while RUNNING (US-020 AC3)', async () => {
    const jobId = await launchSingle();
    await context.setScenario(jobId, 'hang');

    expect(await context.waitForStatus(jobId, ['RUNNING'])).toBe('RUNNING');
    expect(
      await eventually(async () => {
        await context.tick();
        const detail = await owner.get(`/api/v1/jobs/${jobId}`);
        return detail.body.data.progress?.currentStep === 'FASTCAT';
      }),
    ).toBe(true);

    const detail = await owner.get(`/api/v1/jobs/${jobId}`);
    expect(detail.body.data.progress).toMatchObject({ completedSteps: 0, currentStep: 'FASTCAT' });
    expect(detail.body.data).toMatchObject({ cancellable: true, queuePosition: null });
  });
});

describe('failed runs (US-019 AC5)', () => {
  it('fail-step → FAILED with only the step name, partial output and work removed', async () => {
    const jobId = await launchSingle();
    await context.setScenario(jobId, 'fail-step', 50);

    expect(await context.waitForStatus(jobId, ['COMPLETED', 'FAILED'])).toBe('FAILED');

    const detail = await owner.get(`/api/v1/jobs/${jobId}`);
    expect(detail.body.data.failureSummary).toBe(
      'Step FASTCAT failed (exit 1). Check the input and submit again.',
    );
    expect(JSON.stringify(detail.body.data)).not.toContain('Error executing process');
    expect(existsSync(outputDirectory(jobId))).toBe(false);
    expect(existsSync(join(runDirectory(jobId), 'work'))).toBe(false);
    expect(await context.prisma.jobOutputFile.count({ where: { jobId } })).toBe(0);
  });

  it('missing-output → FAILED and no output manifest', async () => {
    const jobId = await launchSingle();
    await context.setScenario(jobId, 'missing-output', 50);

    expect(await context.waitForStatus(jobId, ['COMPLETED', 'FAILED'])).toBe('FAILED');

    const detail = await owner.get(`/api/v1/jobs/${jobId}`);
    expect(detail.body.data.failureSummary).toBe(
      'The pipeline did not produce the expected results. Check the input and submit again.',
    );
    expect(await context.prisma.jobOutputFile.count({ where: { jobId } })).toBe(0);
  });
});

describe('queue (US-019 AC2, NEXTFLOW_MAX_CONCURRENT_RUNS=1)', () => {
  it('runs one job at a time in order and shows queue positions', async () => {
    const first = await launchSingle();
    const second = await launchSingle();
    await context.setScenario(first, 'hang');
    await context.setScenario(second, 'success', 50);

    const before = await owner.get('/api/v1/jobs');
    const positions = Object.fromEntries(
      (before.body.data.items as { id: string; queuePosition: number | null }[]).map((item) => [
        item.id,
        item.queuePosition,
      ]),
    );
    expect([positions[first], positions[second]]).toEqual([1, 2]);

    expect(await context.waitForStatus(first, ['RUNNING'])).toBe('RUNNING');
    await context.tick();
    await context.tick();

    const queued = await owner.get(`/api/v1/jobs/${second}`);
    expect(queued.body.data).toMatchObject({ queuePosition: 1, status: 'QUEUED' });
    expect(await context.prisma.job.count({ where: { status: 'RUNNING' } })).toBe(1);

    await owner.post(`/api/v1/jobs/${first}/cancel`);
    expect(await context.waitForStatus(second, ['COMPLETED', 'FAILED'])).toBe('COMPLETED');
  });
});

describe('cancel (US-021)', () => {
  it('cancels a QUEUED job without ever starting it', async () => {
    const jobId = await launchSingle();
    const response = await owner.post(`/api/v1/jobs/${jobId}/cancel`);

    expect(response.status).toBe(200);
    expect(response.body.data.job).toMatchObject({ queuePosition: null, status: 'CANCELLED' });
    await context.tick();
    expect(existsSync(join(runDirectory(jobId), 'params.json'))).toBe(false);

    const detail = await owner.get(`/api/v1/jobs/${jobId}`);
    expect(detail.body.data).toMatchObject({ cancellable: false, status: 'CANCELLED' });
    expect(detail.body.data.history.at(-1)).toMatchObject({
      status: 'CANCELLED',
      summary: 'Cancelled by the owner.',
    });
  });

  it('cancels a RUNNING job: SIGTERM, task container removed, output removed, record kept', async () => {
    const jobId = await launchSingle();
    await context.setScenario(jobId, 'hang');
    expect(await context.waitForStatus(jobId, ['RUNNING'])).toBe('RUNNING');
    // Containers report getcwd() (symlinks resolved, e.g. /private/var on macOS).
    const realRun = await realpath(runDirectory(jobId));
    expect(
      await eventually(async () =>
        (await context.fakeContainers()).some((item) =>
          item.workingDir.startsWith(join(realRun, 'work')),
        ),
      ),
    ).toBe(true);

    const response = await owner.post(`/api/v1/jobs/${jobId}/cancel`);
    expect(response.status).toBe(200);
    expect(response.body.data.job.status).toBe('CANCELLED');

    expect(await eventually(() => !context.processAlive(jobId))).toBe(true);
    expect(
      await eventually(async () =>
        (await context.fakeContainers()).every((item) => !item.workingDir.startsWith(realRun)),
      ),
    ).toBe(true);
    expect(await eventually(() => !existsSync(outputDirectory(jobId)))).toBe(true);
    expect(await eventually(() => !existsSync(join(runDirectory(jobId), 'work')))).toBe(true);
    expect(await readFile(join(runDirectory(jobId), 'trace.txt'), 'utf8')).toContain('ABORTED');

    const removals = (await context.fakeCalls('docker')).filter((args) => args[0] === 'rm');
    expect(removals.at(-1)?.[1]).toBe('-f');

    const detail = await owner.get(`/api/v1/jobs/${jobId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe('CANCELLED');

    const audit = await context.prisma.auditEvent.findMany({
      where: { eventType: 'JOB_STATUS_CHANGED', resourceId: jobId },
    });
    expect(
      audit.map((row) => JSON.parse(row.metadataJson) as { from: string; to: string }).at(-1),
    ).toEqual({ from: 'RUNNING', to: 'CANCELLED' });
    expect(audit.at(-1)?.actorId).toBe(owner.userId);
  });

  it('answers 409 CONFLICT for a job that already finished', async () => {
    const jobId = await launchSingle();
    await context.setScenario(jobId, 'success', 20);
    expect(await context.waitForStatus(jobId, ['COMPLETED', 'FAILED'])).toBe('COMPLETED');

    const response = await owner.post(`/api/v1/jobs/${jobId}/cancel`);
    const cancelledAgain = await launchSingle();
    await owner.post(`/api/v1/jobs/${cancelledAgain}/cancel`);
    const second = await owner.post(`/api/v1/jobs/${cancelledAgain}/cancel`);

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'This job has already finished.',
    });
    expect(second.status).toBe(409);
    expect((await context.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe(
      'COMPLETED',
    );
  });
});

describe('restart reconciliation (US-008 adjusted)', () => {
  it('marks a run left RUNNING by a restart as FAILED (INTERRUPTED) and stops its process', async () => {
    const jobId = await launchSingle();
    await context.setScenario(jobId, 'hang');
    expect(await context.waitForStatus(jobId, ['RUNNING'])).toBe('RUNNING');
    expect(await eventually(() => context.processAlive(jobId))).toBe(true);

    // `start()` is what server.ts runs on boot: stale RUNNING jobs are never reattached.
    await context.worker.start();

    const detail = await owner.get(`/api/v1/jobs/${jobId}`);
    expect(detail.body.data).toMatchObject({
      failureSummary:
        'Processing was interrupted by a service restart. Please submit the job again.',
      status: 'FAILED',
    });
    expect(await eventually(() => !context.processAlive(jobId))).toBe(true);
    expect(existsSync(join(runDirectory(jobId), 'work'))).toBe(false);
  });
});

describe('retention (US-014 adjusted, C3 staging cleanup)', () => {
  it('removes expired Nextflow jobs with input/run/output and upload staging older than 1 hour', async () => {
    const expired = await launchSingle();
    await context.setScenario(expired, 'success', 20);
    expect(await context.waitForStatus(expired, ['COMPLETED', 'FAILED'])).toBe('COMPLETED');
    await context.prisma.job.update({
      data: { expiresAt: new Date(Date.now() - 1000) },
      where: { id: expired },
    });

    const uploads = join(context.config.storageRoot, 'uploads');
    const staleId = crypto.randomUUID();
    const freshId = crypto.randomUUID();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await mkdir(join(uploads, staleId, 'fastq'), { recursive: true });
    await writeFile(join(uploads, staleId, 'fastq', 'partial.fastq'), '@r\n');
    await utimes(join(uploads, staleId, 'fastq', 'partial.fastq'), twoHoursAgo, twoHoursAgo);
    await utimes(join(uploads, staleId, 'fastq'), twoHoursAgo, twoHoursAgo);
    await utimes(join(uploads, staleId), twoHoursAgo, twoHoursAgo);
    await mkdir(join(uploads, freshId), { recursive: true });

    const audit = createAuditService(context.prisma, { error: () => undefined });
    const logger = { error: () => undefined };
    const jobs = createJobService({
      audit,
      config: context.config,
      isExecutorReady: () => true,
      logger,
      prisma: context.prisma,
      storage: context.storage,
    });
    const result = await createRetentionSweeper({
      audit,
      jobs,
      logger,
      prisma: context.prisma,
      storage: context.storage,
    })();

    expect(result).toMatchObject({ deleted: 1, failed: 0 });
    expect(await context.prisma.job.count({ where: { id: expired } })).toBe(0);
    expect(await context.prisma.jobOutputFile.count({ where: { jobId: expired } })).toBe(0);
    expect(await context.prisma.jobInputFile.count({ where: { jobId: expired } })).toBe(0);
    expect(existsSync(context.storage.jobDirectory(expired))).toBe(false);
    expect((await context.stagingEntries()).sort()).toEqual([freshId]);
  });
});

describe('delete while RUNNING (US-014 adjusted, US-021 AC5)', () => {
  it('stops the run, removes the record and files, and answers 404 afterwards', async () => {
    const jobId = await launchSingle();
    await context.setScenario(jobId, 'hang');
    expect(await context.waitForStatus(jobId, ['RUNNING'])).toBe('RUNNING');
    expect(await eventually(() => context.processAlive(jobId))).toBe(true);
    const realJob = await realpath(context.storage.jobDirectory(jobId));
    expect(
      await eventually(async () =>
        (await context.fakeContainers()).some((item) => item.workingDir.startsWith(realJob)),
      ),
    ).toBe(true);

    const response = await owner.delete(`/api/v1/jobs/${jobId}`);

    expect(response.status).toBe(204);
    expect(context.processAlive(jobId)).toBe(false);
    expect(existsSync(context.storage.jobDirectory(jobId))).toBe(false);
    expect(await context.prisma.job.count({ where: { id: jobId } })).toBe(0);
    expect(await context.prisma.jobInputFile.count({ where: { jobId } })).toBe(0);
    expect(
      (await context.fakeContainers()).some((item) => item.workingDir.startsWith(realJob)),
    ).toBe(false);
    expect((await owner.get(`/api/v1/jobs/${jobId}`)).status).toBe(404);
  });
});
