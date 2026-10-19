import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, rmdir } from 'node:fs/promises';
import type { Server } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { jobResultSchema } from '@portal/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../../../src/config/index.js';
import type { PrismaClient } from '../../../src/generated/prisma/client.js';
import { createApiApp, getJobWorker } from '../../../src/http/app.js';
import { createPrismaClient } from '../../../src/infrastructure/prisma.js';
import { applyTestMigrations } from '../../../src/infrastructure/test-database.js';
import {
  DOWNLOAD_ONLY_REPORT_NOTE,
  VIEW_CONTENT_SECURITY_POLICY,
} from '../../../src/modules/results/report-policy.js';
import { createAuditService } from '../../../src/modules/audit/audit.service.js';
import { createIdentityService } from '../../../src/modules/identity/identity.service.js';
import { createJobStorage, type JobStorage } from '../../../src/modules/jobs/job-storage.js';
import { createSession } from '../../support/http-session.js';
import { TEST_PASSWORD } from '../../support/identity-context.js';
import {
  closeServer,
  listenOnLoopback,
  registerLoopbackServer,
} from '../../support/loopback-server.js';
import { buildMultipart, launchParts, type LaunchSpec } from '../../support/multipart.js';

/**
 * Local real-run suite (design Testing Strategy, task 5.4). Skipped unless `NEXTFLOW_IT=1`;
 * needs `pipelines:setup` to have run (`pipelines:check` passing). Runs si-lol/wf-renamefastq
 * 1.0.3 with real Nextflow + Docker Desktop, offline, on the pipeline's own public test data
 * (copied into a private STORAGE_ROOT through the launch API). STORAGE_ROOT and the database
 * live under `~/portal-data/it-<random>/` (Docker Desktop shares the home directory) and are
 * removed afterwards. Only `nxf-*` containers whose working directory is inside this suite's
 * job directories are ever inspected; nothing else is touched.
 */
const ENABLED = process.env.NEXTFLOW_IT === '1';
const RUN_TIMEOUT_MS = 12 * 60_000;
const TEST_TIMEOUT_MS = 15 * 60_000;
const POLL_MS = 1000;
/** Same pattern as `pipelines:check` (design Add-on Wave 3). */
const REMOTE_CONFIG_PATTERN = /XFileSystemProvider|Parsing config file:\s*[a-z][a-z0-9+.-]*:\/\//i;
const CLONES = join(
  homedir(),
  '.nextflow',
  'assets',
  '.repos',
  'si-lol',
  'wf-renamefastq',
  'clones',
);

let root: string;
let createdParent = false;
let prisma: PrismaClient;
let server: Server;
let storage: JobStorage;
let worker: ReturnType<typeof getJobWorker>;
let owner: ReturnType<typeof createSession>;
let testData: string;
const durations: Record<string, string> = {};

function log(message: string) {
  process.stdout.write(`[real-run] ${message}\n`);
}

function findTestData(): string {
  for (const clone of existsSync(CLONES) ? readdirSync(CLONES) : []) {
    const candidate = join(CLONES, clone, 'assets', 'test_data');

    if (existsSync(join(candidate, 'input_3', 'samplesheet_test.csv'))) {
      return candidate;
    }
  }

  throw new Error('Pipeline test data not found: run pipelines:setup (online) first.');
}

const data = (relativePath: string) => readFile(join(testData, relativePath));

async function launch(spec: LaunchSpec) {
  const { body, contentType } = buildMultipart(launchParts(spec));
  return owner.postRaw('/api/v1/pipelines/wf-renamefastq/runs', body, {
    'Content-Type': contentType,
    'Idempotency-Key': crypto.randomUUID(),
  });
}

async function waitForStatus(
  jobId: string,
  statuses: readonly string[],
  timeoutMs = RUN_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    await worker.tick();
    const row = await prisma.job.findUnique({ select: { status: true }, where: { id: jobId } });
    const status = row?.status ?? 'DELETED';

    if (statuses.includes(status) || Date.now() > deadline) {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function eventually(condition: () => boolean | Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (await condition()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return condition();
}

function processAlive(jobId: string): boolean {
  try {
    execFileSync('pgrep', ['-f', `portal-${jobId}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** IDs of `nxf-*` containers whose working directory is inside `prefix` (never others). */
function runContainers(prefix: string): string[] {
  const ids = execFileSync('docker', ['ps', '-aq', '--filter', 'name=nxf-'], { encoding: 'utf8' })
    .split(/\s+/)
    .filter(Boolean);

  if (ids.length === 0) {
    return [];
  }

  let inspected = '';

  try {
    inspected = execFileSync(
      'docker',
      ['inspect', '--format', '{{.Id}} {{.Config.WorkingDir}}', ...ids],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch (error) {
    // A container that exits between `ps` and `inspect` makes inspect exit 1 with partial output.
    inspected = String((error as { stdout?: string }).stdout ?? '');
  }

  return inspected
    .split('\n')
    .filter((line) => line.slice(line.indexOf(' ') + 1).startsWith(prefix))
    .map((line) => line.slice(0, line.indexOf(' ')));
}

async function expectCompletedRun(name: string, jobId: string, startedAt: number) {
  const status = await waitForStatus(jobId, ['COMPLETED', 'FAILED', 'CANCELLED']);
  durations[name] = `${status} in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`;
  log(`${name}: ${durations[name]}`);

  const runDirectory = storage.jobSubdirectory(jobId, 'run');
  const runLog = await readFile(join(runDirectory, '.nextflow.log'), 'utf8').catch(() => '');

  if (status !== 'COMPLETED') {
    const detail = await owner.get(`/api/v1/jobs/${jobId}`);
    log(`${name}: failure summary: ${String(detail.body.data?.failureSummary)}`);
    // Surface a Docker Desktop bind-mount problem explicitly instead of hiding it.
    log(`${name}: bind-mount error in run log: ${/bind source path does not exist/.test(runLog)}`);
  }

  expect(status).toBe('COMPLETED');

  const outputs = await prisma.jobOutputFile.findMany({ where: { jobId } });
  const params = JSON.parse(await readFile(join(runDirectory, 'params.json'), 'utf8')) as Record<
    string,
    unknown
  >;

  expect(outputs.some((file) => /^fastq\/[^/]+\.fastq\.gz$/.test(file.relativePath))).toBe(true);
  expect(outputs.some((file) => file.relativePath === 'stats/all_fastq_statistics.tsv')).toBe(true);
  expect(existsSync(join(runDirectory, 'work'))).toBe(false);
  expect(existsSync(join(runDirectory, '.nextflow'))).toBe(false);
  expect(existsSync(String(params.custom_config_base))).toBe(false);
  expect(runLog.length).toBeGreaterThan(0);
  // Add-on Wave 3: no institutional config was loaded from a URL (offline run).
  const remote = REMOTE_CONFIG_PATTERN.exec(runLog);
  log(`${name}: .nextflow.log remote config load: ${remote ? `FOUND (${remote[0]})` : 'none'}`);
  expect(remote).toBeNull();
  expect(processAlive(jobId)).toBe(false);
  expect(runContainers(await realpath(storage.jobDirectory(jobId)))).toEqual([]);

  return outputs;
}

/** Columns of seqkit stats `-T` output (design C4), read here independently of the API parser. */
const STATS_COLUMNS = 'file\tformat\ttype\tnum_seqs\tsum_len\tmin_len\tavg_len\tmax_len\tAvgQual';

/**
 * Results & Guidance on a real run (design Testing Strategy — Real-run, task 5.3): `/result`
 * matches the seqkit stats file, the execution report is served by `/view` with the sandbox CSP,
 * and the DAG report (which loads scripts from a CDN) is download-only (`/view` → 404).
 */
async function expectResultAndReports(name: string, jobId: string) {
  const response = await owner.get(`/api/v1/jobs/${jobId}/result`);
  expect(response.status).toBe(200);
  const result = jobResultSchema.parse(response.body.data);
  if (result.pipelineId !== 'wf-renamefastq') {
    throw new Error('Expected a wf-renamefastq result.');
  }
  const statsText = await readFile(
    join(storage.jobSubdirectory(jobId, 'output'), 'stats', 'all_fastq_statistics.tsv'),
    'utf8',
  );
  const [header, ...rows] = statsText.trimEnd().split(/\r?\n/);
  expect(header).toBe(STATS_COLUMNS);
  const expected = rows.map((row) => {
    const [file = '', , , numSeqs, sumLen, minLen, avgLen, maxLen, avgQual] = row.split('\t');
    return {
      avgLen: Number(avgLen),
      avgQual: Number(avgQual),
      maxLen: Number(maxLen),
      minLen: Number(minLen),
      numSeqs: Number(numSeqs),
      sample: (file.split('/').at(-1) ?? '').replace(/\.(fastq|fq)(\.gz)?$/, ''),
      sumLen: Number(sumLen),
    };
  });
  expect(result.samples).toEqual(expected);
  expect(result.summary.sampleCount).toBe(expected.length);
  expect(result.summary.totalReads).toBe(expected.reduce((sum, row) => sum + row.numSeqs, 0));
  expect(result.summary.totalBases).toBe(expected.reduce((sum, row) => sum + row.sumLen, 0));
  expect(result.summary.outputFileCount).toBe(result.artifacts.length);

  const report = result.artifacts.find((artifact) =>
    /^pipeline_info\/execution_report_[^/]*\.html$/.test(artifact.displayName),
  );
  const dag = result.artifacts.find((artifact) =>
    /^pipeline_info\/pipeline_dag_[^/]*\.html$/.test(artifact.displayName),
  );
  expect(report).toMatchObject({ category: 'REPORT', viewable: true });
  expect(dag).toMatchObject({
    category: 'REPORT',
    viewable: false,
    viewNote: DOWNLOAD_ONLY_REPORT_NOTE,
  });

  const view = await owner.agent
    .get(`/api/v1/jobs/${jobId}/artifacts/${report?.id}/view`)
    .responseType('blob');
  expect(view.status).toBe(200);
  expect(view.headers['content-type']).toBe('text/html; charset=utf-8');
  expect(view.headers['content-security-policy']).toBe(VIEW_CONTENT_SECURITY_POLICY);
  expect(String(view.headers['content-security-policy'])).not.toContain('allow-same-origin');
  expect(view.headers['x-content-type-options']).toBe('nosniff');
  expect(view.headers['referrer-policy']).toBe('no-referrer');
  expect((view.body as Buffer).length).toBe(report?.sizeBytes);

  const dagView = await owner.get(`/api/v1/jobs/${jobId}/artifacts/${dag?.id}/view`);
  expect(dagView.status).toBe(404);
  const dagDownload = await owner.agent
    .get(`/api/v1/jobs/${jobId}/artifacts/${dag?.id}/download`)
    .responseType('blob');
  expect(dagDownload.status).toBe(200);
  expect(dagDownload.headers['content-type']).toBe('application/octet-stream');
  expect(String(dagDownload.headers['content-disposition'])).toMatch(/^attachment; /);
  log(
    `${name}: /result 200 (${expected.length} samples, ${result.summary.totalReads} reads, stats match); ` +
      `/view report 200 (${view.headers['content-type']}, sandbox CSP); DAG /view ${dagView.status}, download ${dagDownload.status}`,
  );
}

describe.skipIf(!ENABLED)('real Nextflow runs of wf-renamefastq 1.0.3 (NEXTFLOW_IT=1)', () => {
  beforeAll(async () => {
    testData = findTestData();
    const parent = join(homedir(), 'portal-data');
    createdParent = !existsSync(parent);
    await mkdir(parent, { mode: 0o700, recursive: true });

    if (createdParent) {
      await chmod(parent, 0o700);
    }

    root = await mkdtemp(join(parent, 'it-'));
    await chmod(root, 0o700);
    const storageRoot = join(root, 'storage');
    await mkdir(storageRoot, { mode: 0o700 });
    const databaseUrl = `file:${join(root, 'portal.db')}`;
    applyTestMigrations(databaseUrl);

    const config = loadConfig({
      ALLOWED_ORIGINS: 'https://localhost',
      AUTH_RATE_LIMIT_MAX: '10000',
      DATABASE_URL: databaseUrl,
      EXECUTOR_ENABLED: 'false',
      EXECUTOR_QUEUED_DELAY_MS: '0',
      LOG_LEVEL: 'fatal',
      NEXTFLOW_ENABLED: 'true',
      NODE_ENV: 'test',
      SESSION_SECRET: 'a-secure-test-session-secret-with-32-chars',
      STORAGE_ROOT: storageRoot,
      SUBMIT_RATE_LIMIT_MAX: '10000',
    });
    prisma = createPrismaClient(config.databaseUrl);
    storage = createJobStorage(storageRoot);
    const app = createApiApp(config, prisma, undefined, { isExecutorReady: () => true });
    server = await listenOnLoopback(app);
    registerLoopbackServer(app, server);
    worker = getJobWorker(app);

    const identity = createIdentityService({
      audit: createAuditService(prisma, { error: () => undefined }),
      config,
      prisma,
    });
    const user = await identity.createUser({
      email: 'real-run@example.test',
      password: TEST_PASSWORD,
      requestId: 'test-setup',
      role: 'USER',
    });
    await prisma.user.update({ data: { passwordChangeRequired: false }, where: { id: user.id } });
    owner = createSession(app);
    expect((await owner.login('real-run@example.test', TEST_PASSWORD)).status).toBe(200);

    const ready = await eventually(async () => {
      const catalog = await owner.get('/api/v1/pipelines');
      const item = (catalog.body.data.items as { id: string; available: boolean }[]).find(
        (pipeline) => pipeline.id === 'wf-renamefastq',
      );
      return Boolean(item?.available);
    }, 120_000);
    expect(ready).toBe(true);
  }, 180_000);

  afterAll(async () => {
    await worker?.stop();
    await closeServer(server);
    await prisma?.$disconnect();

    if (root) {
      const leftovers = runContainers(await realpath(root).catch(() => root));
      log(`nxf-* containers left for this suite: ${leftovers.length}`);
      await rm(root, { force: true, recursive: true });
    }

    if (createdParent) {
      await rmdir(join(homedir(), 'portal-data')).catch(() => undefined);
    }

    log(`durations: ${JSON.stringify(durations)}`);
  }, 120_000);

  it(
    'layout 1: a single FASTQ file completes with outputs, offline',
    async () => {
      const startedAt = Date.now();
      const response = await launch({
        files: [
          { content: await data('input_2/fastq_pass/reads01.fastq.gz'), path: 'reads01.fastq.gz' },
        ],
        layout: 'SINGLE_FILE',
        runName: 'Real run single',
        sampleName: 'it_single',
      });
      expect(response.status).toBe(201);

      const jobId = response.body.data.job.id as string;
      const outputs = await expectCompletedRun('layout 1', jobId, startedAt);
      expect(outputs.map((file) => file.relativePath)).toContain('fastq/it_single.fastq.gz');
      await expectResultAndReports('layout 1', jobId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'layout 2: a folder of FASTQ files for one sample completes',
    async () => {
      const startedAt = Date.now();
      const response = await launch({
        files: [
          {
            content: await data('input_2/fastq_pass/reads01.fastq.gz'),
            path: 'fastq_pass/reads01.fastq.gz',
          },
          {
            content: await data('input_2/fastq_pass/reads02.fastq.gz'),
            path: 'fastq_pass/reads02.fastq.gz',
          },
        ],
        layout: 'SAMPLE_FOLDER',
        runName: 'Real run folder',
        sampleName: 'it_folder',
      });
      expect(response.status).toBe(201);

      const jobId = response.body.data.job.id as string;
      const outputs = await expectCompletedRun('layout 2', jobId, startedAt);
      expect(outputs.map((file) => file.relativePath)).toContain('fastq/it_folder.fastq.gz');
      await expectResultAndReports('layout 2', jobId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'layout 3: barcode folders with the sample sheet complete with one output per alias',
    async () => {
      const startedAt = Date.now();
      const response = await launch({
        files: [
          {
            content: await data('input_3/fastq_pass/barcode01/reads01.fastq.gz'),
            path: 'fastq_pass/barcode01/reads01.fastq.gz',
          },
          {
            content: await data('input_3/fastq_pass/barcode02/reads02.fastq.gz'),
            path: 'fastq_pass/barcode02/reads02.fastq.gz',
          },
        ],
        layout: 'BARCODE_FOLDERS',
        runName: 'Real run barcodes',
        sampleSheet: (await data('input_3/samplesheet_test.csv')).toString('utf8'),
      });
      expect(response.status).toBe(201);

      const jobId = response.body.data.job.id as string;
      const outputs = await expectCompletedRun('layout 3', jobId, startedAt);
      const reads = outputs
        .map((file) => file.relativePath)
        .filter((path) => path.startsWith('fastq/'));
      expect(reads).toEqual(
        expect.arrayContaining(['fastq/test_sample01.fastq.gz', 'fastq/test_sample02.fastq.gz']),
      );
      await expectResultAndReports('layout 3', jobId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'demultiplex: a sample folder demultiplexed with the default kit completes',
    async () => {
      const startedAt = Date.now();
      const response = await launch({
        files: [
          {
            content: await data('input_2/fastq_pass/reads01.fastq.gz'),
            path: 'fastq_pass/reads01.fastq.gz',
          },
          {
            content: await data('input_2/fastq_pass/reads02.fastq.gz'),
            path: 'fastq_pass/reads02.fastq.gz',
          },
        ],
        layout: 'SAMPLE_FOLDER',
        options: { demultiplex: true },
        runName: 'Real run demultiplex',
      });
      expect(response.status).toBe(201);

      const jobId = response.body.data.job.id as string;
      await expectCompletedRun('demultiplex', jobId, startedAt);
      await expectResultAndReports('demultiplex', jobId);
    },
    TEST_TIMEOUT_MS,
  );

  it('bad alias: a sheet alias with a space or $ is rejected before any run', async () => {
    const jobsBefore = await prisma.job.count();
    const response = await launch({
      files: [
        {
          content: await data('input_3/fastq_pass/barcode01/reads01.fastq.gz'),
          path: 'fastq_pass/barcode01/reads01.fastq.gz',
        },
        {
          content: await data('input_3/fastq_pass/barcode02/reads02.fastq.gz'),
          path: 'fastq_pass/barcode02/reads02.fastq.gz',
        },
      ],
      layout: 'BARCODE_FOLDERS',
      sampleSheet: 'barcode,alias\nbarcode01,bad alias\nbarcode02,s$2\n',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details.map((detail: { field: string }) => detail.field)).toEqual([
      'sampleSheet.line 2',
      'sampleSheet.line 3',
    ]);
    expect(await prisma.job.count()).toBe(jobsBefore);
    expect(
      existsSync(join(root, 'storage', 'uploads'))
        ? readdirSync(join(root, 'storage', 'uploads'))
        : [],
    ).toEqual([]);
    durations['bad alias'] = 'rejected with 400 before any run';
  });

  it(
    'cancel during a run: CANCELLED, process and task containers gone, record kept',
    async () => {
      const startedAt = Date.now();
      const response = await launch({
        files: [
          {
            content: await data('input_2/fastq_pass/reads01.fastq.gz'),
            path: 'fastq_pass/reads01.fastq.gz',
          },
          {
            content: await data('input_2/fastq_pass/reads02.fastq.gz'),
            path: 'fastq_pass/reads02.fastq.gz',
          },
        ],
        layout: 'SAMPLE_FOLDER',
        options: { demultiplex: true },
        runName: 'Real run cancel',
      });
      expect(response.status).toBe(201);
      const jobId = response.body.data.job.id as string;

      expect(await waitForStatus(jobId, ['RUNNING', 'COMPLETED', 'FAILED'], 120_000)).toBe(
        'RUNNING',
      );
      const runDirectory = storage.jobSubdirectory(jobId, 'run');
      // Cancel once a task was submitted (its container is starting or running).
      const submitted = await eventually(async () => {
        const stdout = await readFile(join(runDirectory, 'nextflow.out.log'), 'utf8').catch(
          () => '',
        );
        return stdout.includes('Submitted process >');
      }, 120_000);
      const realWork = join(await realpath(runDirectory), 'work');
      const containersSeen = runContainers(realWork).length;
      log(`cancel: task submitted=${submitted}, run containers before cancel=${containersSeen}`);

      const cancelled = await owner.post(`/api/v1/jobs/${jobId}/cancel`);
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.data.job.status).toBe('CANCELLED');

      expect(await eventually(() => !processAlive(jobId), 60_000)).toBe(true);
      expect(await eventually(() => runContainers(realWork).length === 0, 60_000)).toBe(true);
      expect(await eventually(() => !existsSync(join(runDirectory, 'work')), 30_000)).toBe(true);
      expect(existsSync(storage.jobSubdirectory(jobId, 'output'))).toBe(false);

      const detail = await owner.get(`/api/v1/jobs/${jobId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.status).toBe('CANCELLED');
      durations.cancel = `CANCELLED after ${((Date.now() - startedAt) / 1000).toFixed(1)} s (containers seen before cancel: ${containersSeen})`;
      log(`cancel: ${durations.cancel}`);
    },
    TEST_TIMEOUT_MS,
  );
});
