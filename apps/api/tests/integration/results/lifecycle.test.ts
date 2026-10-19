import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createResultsTestContext,
  smartCheckupBody,
  statsTsv,
  type ResultsTestContext,
  type TestSession,
} from '../../support/results-context.js';

// Delete and 7-day retention remove results too (design Data Model — Lifecycle, task 4.2):
// `ResultArtifact`/`PackageRecommendation` cascade with the job, `jobs/{jobId}/` is removed and
// the result URLs then answer `404` like any unknown job.

const REPORT_PATH = 'pipeline_info/execution_report_2026-10-19.html';

let context: ResultsTestContext;
let owner: TestSession;

beforeAll(async () => {
  // Default app wiring: the Smart Checkup result builder is the completion handler.
  context = await createResultsTestContext();
  owner = await context.signIn('lifecycle-owner@example.test');
});

afterAll(async () => {
  await context.cleanup();
});

async function completedSmartCheckup(): Promise<{ jobId: string; artifactId: string }> {
  const jobId = await context.completeSmartCheckupJob(
    owner,
    smartCheckupBody('Lifecycle sample', ['fasting_glucose,150,mg/dL', 'alt,40,U/L']),
  );
  const artifact = await context.prisma.resultArtifact.findFirstOrThrow({ where: { jobId } });

  // Preconditions: the result exists before the deletion.
  expect((await owner.get(`/api/v1/jobs/${jobId}/result`)).status).toBe(200);
  expect(await context.prisma.packageRecommendation.count({ where: { jobId } })).toBe(1);
  expect(context.resultFileExists(jobId)).toBe(true);

  return { artifactId: artifact.id, jobId };
}

async function expectResultsRemoved(jobId: string, artifactIds: readonly string[]): Promise<void> {
  expect(await context.prisma.job.count({ where: { id: jobId } })).toBe(0);
  expect(await context.prisma.resultArtifact.count({ where: { jobId } })).toBe(0);
  expect(await context.prisma.packageRecommendation.count({ where: { jobId } })).toBe(0);
  expect(await context.prisma.jobOutputFile.count({ where: { jobId } })).toBe(0);
  expect(context.resultFileExists(jobId)).toBe(false);
  expect(context.jobDirectoryExists(jobId)).toBe(false);
  expect(existsSync(join(context.config.storageRoot, 'jobs', jobId))).toBe(false);

  const result = await owner.get(`/api/v1/jobs/${jobId}/result`);
  expect(result.status).toBe(404);
  expect(result.body.error.code).toBe('NOT_FOUND');

  for (const artifactId of artifactIds) {
    expect((await owner.get(`/api/v1/jobs/${jobId}/artifacts/${artifactId}/download`)).status).toBe(
      404,
    );
    expect((await owner.get(`/api/v1/jobs/${jobId}/artifacts/${artifactId}/view`)).status).toBe(
      404,
    );
  }
}

describe('owner deletion removes the result (US-014, design Lifecycle)', () => {
  it('cascades result rows, removes result.json and the old URLs return 404', async () => {
    const { artifactId, jobId } = await completedSmartCheckup();

    expect((await owner.delete(`/api/v1/jobs/${jobId}`)).status).toBe(204);

    await expectResultsRemoved(jobId, [artifactId]);
  });
});

describe('7-day retention removes the result (US-014 AC2, design Lifecycle)', () => {
  it('sweeps expired Smart Checkup and Nextflow jobs with their results; fresh ones stay', async () => {
    const expired = await completedSmartCheckup();
    const fresh = await completedSmartCheckup();
    const nextflow = await context.seedNextflowJob(owner.userId, [
      {
        category: 'STATS',
        content: statsTsv(['barcode01']),
        contentType: 'text/tab-separated-values',
        relativePath: 'stats/all_fastq_statistics.tsv',
      },
      {
        category: 'REPORT',
        content: '<!doctype html><title>report</title>',
        contentType: 'text/html',
        relativePath: REPORT_PATH,
      },
    ]);
    const reportId = nextflow.outputIds[REPORT_PATH] ?? '';
    expect((await owner.get(`/api/v1/jobs/${nextflow.jobId}/result`)).status).toBe(200);
    expect(
      (await owner.get(`/api/v1/jobs/${nextflow.jobId}/artifacts/${reportId}/view`)).status,
    ).toBe(200);
    await context.expire(expired.jobId);
    await context.expire(nextflow.jobId);

    const sweep = await context.sweepRetention();

    expect(sweep).toEqual({ deleted: 2, failed: 0, orphansRemoved: 0 });
    await expectResultsRemoved(expired.jobId, [expired.artifactId]);
    await expectResultsRemoved(nextflow.jobId, Object.values(nextflow.outputIds));
    // The unexpired job keeps its result.
    expect((await owner.get(`/api/v1/jobs/${fresh.jobId}/result`)).status).toBe(200);
    expect(await context.prisma.resultArtifact.count({ where: { jobId: fresh.jobId } })).toBe(1);
    expect(context.resultFileExists(fresh.jobId)).toBe(true);
    const audit = await context.prisma.auditEvent.findMany({
      where: { eventType: 'JOB_DELETED', resourceId: { in: [expired.jobId, nextflow.jobId] } },
    });
    expect(audit.map((event) => event.metadataJson)).toEqual([
      '{"reason":"RETENTION"}',
      '{"reason":"RETENTION"}',
    ]);
  });
});
