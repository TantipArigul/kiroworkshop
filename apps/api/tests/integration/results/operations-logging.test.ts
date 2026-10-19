import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../../src/config/index.js';
import { createJobStorage } from '../../../src/modules/jobs/job-storage.js';
import {
  createSmartCheckupResultBuilder,
  resultFileName,
} from '../../../src/modules/results/smart-checkup-result.js';
import { createLogger } from '../../../src/shared/logger.js';
import {
  createResultsTestContext,
  smartCheckupBody,
  statsTsv,
  type ResultsTestContext,
  type TestSession,
} from '../../support/results-context.js';

// Every pino logger of this test file (the app's, with the Foundation redaction, and the result
// builder's) writes into `captured` instead of stdout, so the log stream can be inspected.
const captured = vi.hoisted(() => [] as string[]);

vi.mock('pino', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pino')>();
  const capture = { write: (line: string) => void captured.push(line) };
  const pino = Object.assign(
    (options?: Parameters<typeof actual.pino>[0]) => actual.pino(options ?? {}, capture),
    actual.pino,
  );

  return { ...actual, default: pino, pino };
});

// Synthetic canaries that must never reach a log line (design Operations).
const SAMPLE_LABEL = 'Canary label QZ7';
const SAMPLE_ALIAS = 'canary_alias_q7z';
const REPORT_CANARY = 'REPORT-BODY-CANARY-5521';
const MARKER_VALUES = ['123.4567', '77.1234', '1.2345'];
const MARKER_ROWS = [
  `fasting_glucose,${MARKER_VALUES[0]},mg/dL`,
  `alt,${MARKER_VALUES[1]},U/L`,
  `creatinine,${MARKER_VALUES[2]},mg/dL`,
];
const REPORT_PATH = 'pipeline_info/execution_report_2026-10-19.html';
const READS_PATH = `fastq/${SAMPLE_ALIAS}.fastq.gz`;
const STATS_PATH = 'stats/all_fastq_statistics.tsv';

type LogLine = Record<string, unknown> & { msg?: string };

let context: ResultsTestContext;
let owner: TestSession;
let other: TestSession;
let completedJobId: string;
let nextflow: { jobId: string; outputIds: Record<string, string> };

function lines(): LogLine[] {
  return captured.map((line) => JSON.parse(line) as LogLine);
}

function events(message: string): LogLine[] {
  return lines().filter((line) => line.msg === message);
}

/**
 * `Artifact served` is written when the server-side stream settles, which can be just after the
 * client has received the last byte; wait for it instead of racing the response.
 */
async function waitForEvents(message: string, count: number): Promise<LogLine[]> {
  const deadline = Date.now() + 2000;

  while (events(message).length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return events(message);
}

beforeAll(async () => {
  const builderLogger = createLogger({ logLevel: 'info' } as AppConfig);
  context = await createResultsTestContext({
    completionHandler: createSmartCheckupResultBuilder({ logger: builderLogger }),
    environment: { LOG_LEVEL: 'info' },
  });
  owner = await context.signIn('ops-owner@example.test');
  other = await context.signIn('ops-other@example.test');
  completedJobId = await context.completeSmartCheckupJob(
    owner,
    smartCheckupBody(SAMPLE_LABEL, MARKER_ROWS),
  );
  nextflow = await context.seedNextflowJob(owner.userId, [
    {
      category: 'READS',
      content: '@r1\nACGT\n+\nIIII\n',
      contentType: 'application/gzip',
      relativePath: READS_PATH,
    },
    {
      category: 'STATS',
      content: statsTsv([SAMPLE_ALIAS]),
      contentType: 'text/tab-separated-values',
      relativePath: STATS_PATH,
    },
    {
      category: 'REPORT',
      content: `<!doctype html><title>r</title><p>${REPORT_CANARY}</p>`,
      contentType: 'text/html',
      relativePath: REPORT_PATH,
    },
  ]);
});

afterAll(async () => {
  await context.cleanup();
});

beforeEach(() => {
  captured.length = 0;
});

async function smartCheckupArtifactId(jobId: string): Promise<string> {
  const artifact = await context.prisma.resultArtifact.findFirstOrThrow({ where: { jobId } });
  return artifact.id;
}

describe('C3 result generation events', () => {
  it('logs Result generated with job, rule and version only', async () => {
    captured.length = 0;
    const jobId = await context.completeSmartCheckupJob(
      owner,
      smartCheckupBody(SAMPLE_LABEL, MARKER_ROWS),
    );
    const recommendation = await context.prisma.packageRecommendation.findUniqueOrThrow({
      where: { jobId },
    });
    const generated = events('Result generated').find((line) => line.jobId === jobId);

    expect(generated).toMatchObject({
      jobId,
      level: 30,
      ruleId: recommendation.ruleIdentifier,
      ruleVersion: recommendation.ruleVersion,
    });
    expect(Object.keys(generated ?? {}).sort()).toEqual(
      ['hostname', 'jobId', 'level', 'msg', 'pid', 'ruleId', 'ruleVersion', 'time'].sort(),
    );
  });
});

describe('error mapping and operational events (design C5–C7, Operations)', () => {
  it('serves result, download and view, logging Artifact served per mode', async () => {
    const artifactId = await smartCheckupArtifactId(completedJobId);

    expect((await owner.get(`/api/v1/jobs/${completedJobId}/result`)).status).toBe(200);
    const download = await owner.get(
      `/api/v1/jobs/${completedJobId}/artifacts/${artifactId}/download`,
    );
    expect(download.status).toBe(200);
    const view = await owner.get(
      `/api/v1/jobs/${nextflow.jobId}/artifacts/${nextflow.outputIds[REPORT_PATH]}/view`,
    );
    expect(view.status).toBe(200);
    expect((await owner.get(`/api/v1/jobs/${nextflow.jobId}/result`)).status).toBe(200);
    const reads = await owner.get(
      `/api/v1/jobs/${nextflow.jobId}/artifacts/${nextflow.outputIds[READS_PATH]}/download`,
    );
    expect(reads.status).toBe(200);

    const served = await waitForEvents('Artifact served', 3);
    expect(served).toEqual([
      expect.objectContaining({
        artifactId,
        bytes: Number(download.headers['content-length']),
        category: 'RESULT',
        jobId: completedJobId,
        level: 30,
        mode: 'download',
      }),
      expect.objectContaining({
        artifactId: nextflow.outputIds[REPORT_PATH],
        category: 'REPORT',
        jobId: nextflow.jobId,
        mode: 'view',
      }),
      expect.objectContaining({
        artifactId: nextflow.outputIds[READS_PATH],
        category: 'READS',
        jobId: nextflow.jobId,
        mode: 'download',
      }),
    ]);
    // Request log lines exist and their Content-Disposition is redacted (Wave 3 Add-on).
    // pino-http says "request aborted" when the test client closes right after the last byte.
    const requestLines = lines().filter((line) =>
      ['request completed', 'request aborted'].includes(line.msg ?? ''),
    );
    expect(requestLines.length).toBeGreaterThanOrEqual(5);
    expect(captured.join('')).toMatch(/"content-disposition":"\[redacted\]"/i);
  });

  it('maps a job that is not COMPLETED to 409 on every endpoint', async () => {
    const jobId = await context.submitSmartCheckupJob(owner);
    const placeholder = 'c'.padEnd(25, '0');

    const result = await owner.get(`/api/v1/jobs/${jobId}/result`);
    expect(result.status).toBe(409);
    expect(result.body.error).toMatchObject({
      code: 'CONFLICT',
      details: [{ field: 'status', message: 'QUEUED' }],
    });
    expect(
      (await owner.get(`/api/v1/jobs/${jobId}/artifacts/${placeholder}/download`)).status,
    ).toBe(409);
    expect((await owner.get(`/api/v1/jobs/${jobId}/artifacts/${placeholder}/view`)).status).toBe(
      409,
    );
    expect(events('Result unavailable')).toEqual([]);
  });

  it('maps foreign, unknown, malformed and non-viewable to 404 without result events', async () => {
    const artifactId = await smartCheckupArtifactId(completedJobId);

    expect((await other.get(`/api/v1/jobs/${completedJobId}/result`)).status).toBe(404);
    expect(
      (await other.get(`/api/v1/jobs/${completedJobId}/artifacts/${artifactId}/download`)).status,
    ).toBe(404);
    expect((await owner.get('/api/v1/jobs/not-a-job-id/result')).status).toBe(404);
    expect(
      (await owner.get(`/api/v1/jobs/${completedJobId}/artifacts/not-an-id/download`)).status,
    ).toBe(404);
    // An artifact of another job, requested under this job's ID.
    expect(
      (
        await owner.get(
          `/api/v1/jobs/${completedJobId}/artifacts/${nextflow.outputIds[REPORT_PATH]}/view`,
        )
      ).status,
    ).toBe(404);
    // Smart Checkup result.json is download-only.
    expect(
      (await owner.get(`/api/v1/jobs/${completedJobId}/artifacts/${artifactId}/view`)).status,
    ).toBe(404);

    expect(events('Result unavailable')).toEqual([]);
    expect(events('Artifact served')).toEqual([]);
    expect(events('Artifact missing')).toEqual([]);
  });

  it('maps a removed result file to 410 and logs Result unavailable / Artifact missing', async () => {
    const jobId = await context.completeSmartCheckupJob(
      owner,
      smartCheckupBody(SAMPLE_LABEL, MARKER_ROWS),
    );
    const artifactId = await smartCheckupArtifactId(jobId);
    await rm(join(createJobStorage(context.config.storageRoot).jobDirectory(jobId), 'result.json'));
    captured.length = 0;

    const result = await owner.get(`/api/v1/jobs/${jobId}/result`);
    expect(result.status).toBe(410);
    expect(result.body.error.code).toBe('GONE');
    expect((await owner.get(`/api/v1/jobs/${jobId}/artifacts/${artifactId}/download`)).status).toBe(
      410,
    );

    expect(events('Result unavailable')).toEqual([
      expect.objectContaining({ jobId, level: 40, reason: 'MISSING' }),
    ]);
    expect(events('Artifact missing')).toEqual([
      expect.objectContaining({ artifactId, jobId, level: 40 }),
    ]);
    expect(events('Artifact served')).toEqual([]);
  });

  it('maps an unparseable Nextflow stats file to 410 INVALID', async () => {
    const seeded = await context.seedNextflowJob(owner.userId, [
      {
        category: 'STATS',
        content: `bad header\n${SAMPLE_ALIAS}\t1\n`,
        contentType: 'text/tab-separated-values',
        relativePath: STATS_PATH,
      },
    ]);
    captured.length = 0;

    expect((await owner.get(`/api/v1/jobs/${seeded.jobId}/result`)).status).toBe(410);
    expect(events('Result unavailable')).toEqual([
      expect.objectContaining({ jobId: seeded.jobId, reason: 'INVALID' }),
    ]);
  });

  it('maps a corrupt result.json to 500 with a safe message and logs INVALID', async () => {
    const jobId = await context.completeSmartCheckupJob(
      owner,
      smartCheckupBody(SAMPLE_LABEL, MARKER_ROWS),
    );
    const path = join(
      createJobStorage(context.config.storageRoot).jobDirectory(jobId),
      'result.json',
    );
    const original = await readFile(path, 'utf8');
    await writeFile(path, original.replace('"schemaVersion": 2', '"schemaVersion": 9'));
    captured.length = 0;

    const result = await owner.get(`/api/v1/jobs/${jobId}/result`);
    expect(result.status).toBe(500);
    expect(result.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Unable to complete the request.',
    });
    expect(events('Result unavailable')).toEqual([
      expect.objectContaining({ jobId, reason: 'INVALID' }),
    ]);
  });
});

describe('log stream content (design Operations, task 4.1 acceptance)', () => {
  it('contains no file name, alias, storage path, marker value or report content', async () => {
    // One full pass over every endpoint, then grep the whole captured stream.
    const jobId = await context.completeSmartCheckupJob(
      owner,
      smartCheckupBody(SAMPLE_LABEL, MARKER_ROWS),
    );
    const artifactId = await smartCheckupArtifactId(jobId);
    await owner.get(`/api/v1/jobs/${jobId}/result`);
    await owner.get(`/api/v1/jobs/${jobId}/artifacts/${artifactId}/download`);
    await owner.get(`/api/v1/jobs/${nextflow.jobId}/result`);
    for (const id of Object.values(nextflow.outputIds)) {
      await owner.get(`/api/v1/jobs/${nextflow.jobId}/artifacts/${id}/download`);
    }
    await owner.get(
      `/api/v1/jobs/${nextflow.jobId}/artifacts/${nextflow.outputIds[REPORT_PATH]}/view`,
    );
    await rm(join(createJobStorage(context.config.storageRoot).jobDirectory(jobId), 'result.json'));
    await owner.get(`/api/v1/jobs/${jobId}/result`);
    await owner.get(`/api/v1/jobs/${jobId}/artifacts/${artifactId}/download`);

    const stream = captured.join('');
    expect(events('Result generated').map((line) => line.jobId)).toContain(jobId);
    expect((await waitForEvents('Artifact served', 5)).length).toBe(5);
    expect(events('Result unavailable')).toHaveLength(1);
    expect(events('Artifact missing')).toHaveLength(1);

    const forbidden = [
      resultFileName(jobId),
      'result.json',
      SAMPLE_LABEL,
      SAMPLE_ALIAS,
      REPORT_PATH,
      'execution_report',
      'all_fastq_statistics',
      REPORT_CANARY,
      context.config.storageRoot,
      ...MARKER_VALUES,
    ];
    for (const value of forbidden) {
      expect(stream, `log stream contains "${value}"`).not.toContain(value);
    }
  });
});
