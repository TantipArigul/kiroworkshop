import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  jobDetailSchema,
  jobSubmitResponseSchema,
  pipelineDetailSchema,
  pipelineListSchema,
} from '@portal/shared';

import { SAMPLE_INPUT } from '../../../src/modules/jobs/sample-input.js';
import { createSession } from '../../support/http-session.js';
import { TEST_PASSWORD } from '../../support/identity-context.js';
import { buildMultipart, launchParts } from '../../support/multipart.js';
import {
  createPipelinesTestContext,
  type PipelinesTestContext,
  type TestSession,
} from '../../support/pipelines-context.js';

const LIMITS = { maxFastqFiles: 3, maxTotalBytes: 4096, sampleSheetMaxBytes: 1024 };
const SHEET = 'barcode,alias\nbarcode01,s01\nbarcode02,s02\n';

let context: PipelinesTestContext;
let owner: TestSession;
let other: TestSession;

beforeAll(async () => {
  context = await createPipelinesTestContext({ uploadLimits: LIMITS });
  owner = await context.signIn('pipelines-owner@example.test');
  other = await context.signIn('pipelines-other@example.test');
  expect(await context.waitForReadiness(owner)).toEqual({
    available: true,
    unavailableReason: null,
  });
});

afterAll(async () => {
  await context.cleanup();
});

async function auditRows(eventType: string) {
  return context.prisma.auditEvent.findMany({
    orderBy: { occurredAt: 'asc' },
    where: { eventType },
  });
}

async function expectNothingKept(jobsBefore: number) {
  expect(await context.prisma.job.count()).toBe(jobsBefore);
  expect(await context.stagingEntries()).toEqual([]);
}

describe('authentication and request guards', () => {
  it('requires a session, a changed password and CSRF on every pipeline route', async () => {
    const anonymous = createSession(context.app);
    await anonymous.refreshCsrfToken();
    const { body, contentType } = buildMultipart(
      launchParts({ files: ['r.fastq.gz'], layout: 'SINGLE_FILE' }),
    );

    for (const path of ['/api/v1/pipelines', '/api/v1/pipelines/wf-renamefastq']) {
      const response = await anonymous.get(path);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    }

    const launch = await anonymous.postRaw('/api/v1/pipelines/wf-renamefastq/runs', body, {
      'Content-Type': contentType,
      'Idempotency-Key': crypto.randomUUID(),
    });
    expect(launch.status).toBe(401);

    const fresh = await context.createUser('pipelines-new@example.test');
    const pending = createSession(context.app);
    await pending.login(fresh.email, TEST_PASSWORD);
    const gated = await pending.get('/api/v1/pipelines');
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const noCsrf = await owner.agent
      .post('/api/v1/pipelines/wf-renamefastq/runs')
      .set({ 'Content-Type': contentType, 'Idempotency-Key': crypto.randomUUID() })
      .send(body);
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_INVALID');
  });

  it('requires a UUID Idempotency-Key before reading the body', async () => {
    const before = await context.prisma.job.count();
    const response = await context.launch(
      owner,
      { files: ['r.fastq.gz'], layout: 'SINGLE_FILE' },
      { idempotencyKey: 'retry-1' },
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([
      { field: 'Idempotency-Key', message: 'Send a UUID Idempotency-Key header.' },
    ]);
    await expectNothingKept(before);
  });
});

describe('GET /api/v1/pipelines (US-016)', () => {
  it('lists Smart Checkup and wf-renamefastq with availability', async () => {
    const response = await owner.get('/api/v1/pipelines');

    expect(response.status).toBe(200);
    expect(() => pipelineListSchema.parse(response.body.data)).not.toThrow();
    expect(response.body.data.items).toEqual([
      expect.objectContaining({
        available: true,
        executor: 'simulated',
        id: 'smart-checkup',
        inputLayouts: [],
        unavailableReason: null,
      }),
      expect.objectContaining({
        available: true,
        executor: 'nextflow',
        id: 'wf-renamefastq',
        inputLayouts: ['SINGLE_FILE', 'SAMPLE_FOLDER', 'BARCODE_FOLDERS'],
        unavailableReason: null,
        version: '1.0.3',
      }),
    ]);
  });

  it('returns options and requirement limits for a pipeline, 404 for unknown IDs', async () => {
    const detail = await owner.get('/api/v1/pipelines/wf-renamefastq');
    const smart = await owner.get('/api/v1/pipelines/smart-checkup');
    const unknown = await owner.get('/api/v1/pipelines/not-a-pipeline');

    expect(detail.status).toBe(200);
    expect(() => pipelineDetailSchema.parse(detail.body.data)).not.toThrow();
    expect(detail.body.data.limits).toEqual({
      fastqExtensions: ['.fastq', '.fq', '.fastq.gz', '.fq.gz'],
      maxFastqFiles: 10,
      maxTotalBytes: 1_073_741_824,
      sampleSheetMaxBytes: 65_536,
    });
    expect(detail.body.data.options.map((option: { key: string }) => option.key)).toEqual([
      'demultiplex',
      'kitName',
      'qualityFilter',
      'qScore',
    ]);
    expect(smart.body.data).toMatchObject({ limits: null, options: [] });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/v1/pipelines/{id}/runs (US-017, US-018)', () => {
  it('launches a single file (layout 1) as QUEUED with rows and files under input/', async () => {
    const response = await context.launch(owner, {
      files: ['reads01.fastq.gz'],
      layout: 'SINGLE_FILE',
      runName: 'Single file run',
      sampleName: 'sample_01',
    });

    expect(response.status).toBe(201);
    expect(() => jobSubmitResponseSchema.parse(response.body.data)).not.toThrow();
    const job = response.body.data.job;
    expect(job).toMatchObject({
      pipelineId: 'wf-renamefastq',
      pipelineName: 'wf-renamefastq',
      runName: 'Single file run',
      sampleLabel: 'Single file run',
      status: 'QUEUED',
    });
    expect(response.body.data.statusUrl).toBe(`/jobs/${job.id}`);

    const row = await context.prisma.job.findUniqueOrThrow({
      include: { input: true, inputFiles: true },
      where: { id: job.id },
    });
    expect(row).toMatchObject({ pipelineRevision: '1.0.3', runName: 'Single file run' });
    expect(JSON.parse(row.input!.parametersJson)).toEqual({
      layout: 'SINGLE_FILE',
      options: { demultiplex: false, kitName: 'BiK-HLA114-96', qScore: 14, qualityFilter: true },
      sampleName: 'sample_01',
    });
    expect(row.input!.storageKey).toBe(`jobs/${job.id}/input`);
    expect(row.inputFiles.map((file) => [file.relativePath, file.kind])).toEqual([
      ['fastq/reads01.fastq.gz', 'FASTQ'],
    ]);
    expect(await readdir(join(context.storage.jobSubdirectory(job.id, 'input'), 'fastq'))).toEqual([
      'reads01.fastq.gz',
    ]);
    expect(await context.stagingEntries()).toEqual([]);

    const submitted = await auditRows('JOB_SUBMITTED');
    expect(JSON.parse(submitted.at(-1)!.metadataJson)).toEqual({
      pipelineId: 'wf-renamefastq',
      status: 'QUEUED',
    });
  });

  it('launches a sample folder (layout 2) and exposes the run in the detail DTO', async () => {
    const response = await context.launch(owner, {
      files: ['fastq_pass/a.fastq.gz', 'fastq_pass/b.fq'],
      layout: 'SAMPLE_FOLDER',
      options: { demultiplex: true, kitName: 'SQK-NBD114-24' },
      runName: 'Folder run',
    });
    expect(response.status).toBe(201);

    const detail = await owner.get(`/api/v1/jobs/${response.body.data.job.id}`);
    expect(() => jobDetailSchema.parse(detail.body.data)).not.toThrow();
    expect(detail.body.data).toMatchObject({
      cancellable: true,
      file: null,
      outputs: null,
      parameters: null,
      queuePosition: expect.any(Number) as number,
      run: {
        layout: 'SAMPLE_FOLDER',
        options: { demultiplex: true, kitName: 'SQK-NBD114-24' },
        sampleName: null,
      },
    });
    expect(
      detail.body.data.run.files.map((file: { relativePath: string }) => file.relativePath),
    ).toEqual(['fastq_pass/a.fastq.gz', 'fastq_pass/b.fq']);
  });

  it('launches barcode folders (layout 3) with a sample sheet stored as sample_sheet.csv', async () => {
    const response = await context.launch(owner, {
      files: ['run/barcode01/a.fastq.gz', 'run/barcode02/b.fastq.gz', 'run/unclassified/u.fq'],
      layout: 'BARCODE_FOLDERS',
      sampleSheet: SHEET,
    });

    expect(response.status).toBe(201);
    const jobId = response.body.data.job.id as string;
    const row = await context.prisma.job.findUniqueOrThrow({
      include: { input: true, inputFiles: true },
      where: { id: jobId },
    });

    expect(JSON.parse(row.input!.fileMetadataJson)).toMatchObject({
      barcodes: ['barcode01', 'barcode02'],
      fileCount: 3,
    });
    expect(row.inputFiles.map((file) => file.kind).sort()).toEqual([
      'FASTQ',
      'FASTQ',
      'FASTQ',
      'SAMPLE_SHEET',
    ]);
    expect(
      await readFile(
        join(context.storage.jobSubdirectory(jobId, 'input'), 'sample_sheet.csv'),
        'utf8',
      ),
    ).toBe(SHEET);
  });

  it('replays the same Idempotency-Key with 200 and the same job, keeping no second upload', async () => {
    const key = crypto.randomUUID();
    const spec = { files: ['replay.fastq.gz'], layout: 'SINGLE_FILE' as const };
    const first = await context.launch(owner, spec, { idempotencyKey: key });
    const second = await context.launch(owner, spec, { idempotencyKey: key });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.job.id).toBe(first.body.data.job.id);
    expect(await context.prisma.job.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await context.stagingEntries()).toEqual([]);
  });

  it('rejects a path traversal with 400, an UNSAFE_PATH audit event and nothing kept (US-018 AC2)', async () => {
    const before = await context.prisma.job.count();
    const audits = (await auditRows('JOB_INPUT_REJECTED')).length;
    const response = await context.launch(owner, {
      files: ['../../escape.fastq.gz'],
      layout: 'SINGLE_FILE',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details[0].field).toBe('files');
    expect(JSON.stringify(response.body)).not.toContain('escape');
    await expectNothingKept(before);

    const rejected = await auditRows('JOB_INPUT_REJECTED');
    expect(rejected).toHaveLength(audits + 1);
    expect(rejected.at(-1)).toMatchObject({ actorId: owner.userId, outcome: 'DENIED' });
    expect(JSON.parse(rejected.at(-1)!.metadataJson)).toEqual({ reason: 'UNSAFE_PATH' });
    expect(existsSync(join(context.config.storageRoot, 'escape.fastq.gz'))).toBe(false);
  });

  it('rejects uploads over the file-count or size limit with LIMIT_EXCEEDED and nothing kept (US-018 AC1, AC6)', async () => {
    const before = await context.prisma.job.count();
    const filesBefore = await context.prisma.jobInputFile.count();
    // Paced like a browser upload (see launchPaced): each file under the per-file limit, the
    // total over it, and a fourth file over the count limit.
    const half = `@${'A'.repeat(2499)}`;
    const tooLarge = await context.launchPaced(owner, {
      files: [
        { content: half, path: 'd/a.fastq' },
        { content: half, path: 'd/b.fastq' },
      ],
      layout: 'SAMPLE_FOLDER',
    });
    const tooMany = await context.launchPaced(owner, {
      files: ['d/a.fastq', 'd/b.fastq', 'd/c.fastq', 'd/e.fastq'],
      layout: 'SAMPLE_FOLDER',
    });

    expect(tooLarge.status).toBe(400);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error?.details).toEqual([
      { field: 'files', message: 'Upload at most 3 FASTQ files and 4 KB in total.' },
    ]);
    expect(await context.prisma.job.count()).toBe(before);
    expect(await context.prisma.jobInputFile.count()).toBe(filesBefore);
    expect(await context.stagingEntries()).toEqual([]);
    expect(
      (await auditRows('JOB_INPUT_REJECTED'))
        .slice(-2)
        .map((row) => JSON.parse(row.metadataJson).reason),
    ).toEqual(['LIMIT_EXCEEDED', 'LIMIT_EXCEEDED']);
  });

  it.each([
    [
      'a sample sheet that does not match the barcode folders',
      {
        files: ['run/barcode01/a.fastq.gz', 'run/barcode02/b.fastq.gz'],
        layout: 'BARCODE_FOLDERS' as const,
        sampleSheet: 'barcode,alias\nbarcode01,s01\nbarcode03,s03\n',
      },
      'sampleSheet',
    ],
    [
      'demultiplex with barcode folders',
      {
        files: ['run/barcode01/a.fastq.gz'],
        layout: 'BARCODE_FOLDERS' as const,
        options: { demultiplex: true },
        sampleSheet: 'barcode,alias\nbarcode01,s01\n',
      },
      'options.demultiplex',
    ],
    [
      'an alias with a space',
      {
        files: ['run/barcode01/a.fastq.gz'],
        layout: 'BARCODE_FOLDERS' as const,
        sampleSheet: 'barcode,alias\nbarcode01,bad alias\n',
      },
      'sampleSheet.line 2',
    ],
    [
      'an alias with $',
      {
        files: ['run/barcode01/a.fastq.gz'],
        layout: 'BARCODE_FOLDERS' as const,
        sampleSheet: 'barcode,alias\nbarcode01,s$1\n',
      },
      'sampleSheet.line 2',
    ],
    [
      'a sample name with a space',
      { files: ['r.fastq.gz'], layout: 'SINGLE_FILE' as const, sampleName: 'bad name' },
      'sampleName',
    ],
    [
      'files that do not match the chosen layout',
      {
        files: ['d/a.fastq.gz', 'd/b.fastq.gz'],
        layout: 'SAMPLE_FOLDER' as const,
        sampleSheet: SHEET,
      },
      'sampleSheet',
    ],
    [
      'an unknown option',
      { files: ['r.fastq.gz'], layout: 'SINGLE_FILE' as const, options: { resume: true } },
      'options',
    ],
  ])('rejects %s before any run with 400 and no staging', async (_label, spec, field) => {
    const before = await context.prisma.job.count();
    const response = await context.launch(owner, spec);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.map((detail: { field: string }) => detail.field)).toContain(
      field,
    );
    expect(JSON.stringify(response.body.error)).not.toMatch(/bad alias|s\$1|bad name/);
    await expectNothingKept(before);
  });

  it('returns 404 for a pipeline that is not launched through this route', async () => {
    const before = await context.prisma.job.count();
    const smart = await context.launch(
      owner,
      { files: ['r.fastq.gz'], layout: 'SINGLE_FILE' },
      { pipelineId: 'smart-checkup' },
    );
    const unknown = await context.launch(
      owner,
      { files: ['r.fastq.gz'], layout: 'SINGLE_FILE' },
      { pipelineId: 'not-a-pipeline' },
    );

    expect(smart.status).toBe(404);
    expect(unknown.status).toBe(404);
    await expectNothingKept(before);
  });
});

describe('ownership (US-002 adjusted, IDOR)', () => {
  it('returns the same 404 for foreign jobs on every job route and lists none', async () => {
    const launched = await context.launch(owner, {
      files: ['own.fastq.gz'],
      layout: 'SINGLE_FILE',
    });
    const jobId = launched.body.data.job.id as string;
    const before = await context.prisma.job.findUniqueOrThrow({ where: { id: jobId } });

    const responses = [
      await other.get(`/api/v1/jobs/${jobId}`),
      await other.post(`/api/v1/jobs/${jobId}/cancel`),
      await other.delete(`/api/v1/jobs/${jobId}`),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body.error.message).toBe('This job is unavailable.');
    }

    expect((await other.get('/api/v1/jobs')).body.data.total).toBe(0);
    expect(await context.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).toEqual(before);
  });
});

describe('Smart Checkup regression and readiness', () => {
  it('still submits and completes a Smart Checkup job through POST /jobs', async () => {
    const response = await owner.post(
      '/api/v1/jobs',
      { file: SAMPLE_INPUT.file, parameters: SAMPLE_INPUT.parameters },
      { 'Idempotency-Key': crypto.randomUUID() },
    );
    const jobId = response.body.data.job.id as string;

    expect(response.status).toBe(201);
    expect(response.body.data.job).toMatchObject({
      pipelineId: 'smart-checkup',
      pipelineName: 'Smart Checkup',
      status: 'QUEUED',
    });
    expect(await context.waitForStatus(jobId, ['COMPLETED', 'FAILED'])).toBe('COMPLETED');

    const detail = await owner.get(`/api/v1/jobs/${jobId}`);
    expect(detail.body.data).toMatchObject({ cancellable: false, run: null });
    expect(detail.body.data.parameters).not.toBeNull();
  });

  it('reports pipeline readiness in /health/ready without affecting overall readiness', async () => {
    const response = await owner.get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      checks: { database: 'ok', executor: 'ok', 'pipeline:wf-renamefastq': 'ok' },
      status: 'ready',
    });
  });
});
