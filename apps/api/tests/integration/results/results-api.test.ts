import { readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { INPUT_FILE_HEADER, jobResultSchema } from '@portal/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JobCompletionHandler } from '../../../src/modules/jobs/completion.js';
import { STATUS_SUMMARIES } from '../../../src/modules/jobs/job.service.js';
import { evaluate, RULESET_VERSION } from '../../../src/modules/results/recommendation-rules.js';
import {
  DOWNLOAD_CONTENT_SECURITY_POLICY,
  DOWNLOAD_ONLY_REPORT_NOTE,
  VIEW_CONTENT_SECURITY_POLICY,
} from '../../../src/modules/results/report-policy.js';
import {
  createSmartCheckupResultBuilder,
  resultFileName,
} from '../../../src/modules/results/smart-checkup-result.js';
import { createSession } from '../../support/http-session.js';
import { TEST_PASSWORD } from '../../support/identity-context.js';
import {
  createResultsTestContext,
  DAG_HTML_EXTERNAL,
  fakeFastqGz,
  NEXTFLOW_PATHS,
  nextflowOutputs,
  REPORT_HTML_INLINE_SCRIPT,
  statsTsv,
  type ResultsTestContext,
  type TestSession,
} from '../../support/results-context.js';

// Results API integration (design Testing Strategy — main integration cases, task 5.2).
// Lifecycle (delete/retention → 404) lives in lifecycle.test.ts; log events and the QUEUED/
// foreign/removed/corrupt basics in operations-logging.test.ts. No Nextflow or Docker is used:
// wf-renamefastq jobs are seeded with synthetic output files.

const GONE_MESSAGE =
  'The result files were removed by the retention policy or are no longer available.';
const SAMPLES = ['sample_a', 'sample_b'];
const MISSING_JOB_ID = 'cmissingjob00000000000000';
const NOT_COMPLETED = ['QUEUED', 'RUNNING', 'FAILED', 'CANCELLED'] as const;

/** Completion handler mode, switched per test: the real builder, or one that fails. */
let mode: 'ok' | 'handler-throws' | 'finalize-throws' = 'ok';
const builder = createSmartCheckupResultBuilder();
const switchableHandler: JobCompletionHandler = async (completion) => {
  if (mode === 'handler-throws') {
    // The builder's own write fails: nothing is written and no finalize step exists.
    return builder({
      ...completion,
      storage: {
        ...completion.storage,
        writeResult: async () => {
          throw new Error('synthetic write failure');
        },
      },
    });
  }
  const outcome = await builder(completion);
  if (mode === 'finalize-throws' && outcome) {
    return {
      finalize: async (tx) => {
        await outcome.finalize(tx);
        throw new Error('synthetic finalize failure');
      },
    };
  }
  return outcome;
};

let context: ResultsTestContext;
let owner: TestSession;
let other: TestSession;
let nextflow: { jobId: string; outputIds: Record<string, string> };

/** Raw response bytes as a Buffer (superagent would otherwise parse JSON downloads). */
function getBytes(session: TestSession, path: string) {
  return session.agent.get(path).responseType('blob');
}

function body(
  focusArea: string,
  lifestyleFactors: string[],
  rows: string[],
  sampleLabel = 'Synthetic result sample',
) {
  return {
    file: { content: [INPUT_FILE_HEADER, ...rows, ''].join('\n'), name: 'synthetic-input.csv' },
    parameters: {
      ageBand: '40-49',
      focusArea,
      lifestyleFactors,
      sampleLabel,
      simulateFailure: false,
    },
  };
}

async function jobStatus(jobId: string): Promise<string> {
  return (await context.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status;
}

async function resultRows(jobId: string) {
  return {
    artifacts: await context.prisma.resultArtifact.findMany({ where: { jobId } }),
    recommendations: await context.prisma.packageRecommendation.findMany({ where: { jobId } }),
  };
}

async function auditEvents(eventType: string, resourceId: string) {
  return context.prisma.auditEvent.findMany({ where: { eventType, resourceId } });
}

beforeAll(async () => {
  context = await createResultsTestContext({ completionHandler: switchableHandler });
  owner = await context.signIn('results-owner@example.test');
  other = await context.signIn('results-other@example.test');
  nextflow = await context.seedNextflowJob(owner.userId, nextflowOutputs(SAMPLES));
});

afterAll(async () => {
  await context.cleanup();
});

describe('Smart Checkup completion creates the result (design C3, US-009 AC4, US-010)', () => {
  it('COMPLETED with result.json, ResultArtifact and a matched PackageRecommendation', async () => {
    mode = 'ok';
    const jobId = await context.completeSmartCheckupJob(
      owner,
      body('LIVER', ['HIGH_ALCOHOL'], ['alt,300,U/L', 'creatinine,1.1,mg/dL']),
    );
    expect(await jobStatus(jobId)).toBe('COMPLETED');
    const rows = await resultRows(jobId);
    expect(rows.artifacts).toEqual([
      expect.objectContaining({
        contentType: 'application/json',
        fileName: resultFileName(jobId),
        storageKey: `jobs/${jobId}/result.json`,
      }),
    ]);
    expect(rows.recommendations).toEqual([
      expect.objectContaining({
        matchedFactors: JSON.stringify(['focusArea:LIVER', 'marker:alt', 'lifestyle:HIGH_ALCOHOL']),
        packageLabel: 'Training Package C — Liver',
        ruleIdentifier: 'MOCK-LIVER-01',
        ruleVersion: RULESET_VERSION,
      }),
    ]);
    const file = JSON.parse(
      await readFile(join(context.jobDirectory(jobId), 'result.json'), 'utf8'),
    );
    expect(file.schemaVersion).toBe(2);

    const response = await owner.get(`/api/v1/jobs/${jobId}/result`);
    expect(response.status).toBe(200);
    const result = jobResultSchema.parse(response.body.data);
    if (result.pipelineId !== 'smart-checkup') {
      throw new Error('Expected a Smart Checkup result.');
    }
    expect(result.recommendation).toEqual(
      evaluate({
        focusArea: 'LIVER',
        lifestyleFactors: ['HIGH_ALCOHOL'],
        rows: [
          { marker: 'alt', value: 300 },
          { marker: 'creatinine', value: 1.1 },
        ],
      }),
    );
    expect(result.markers.map((marker) => [marker.marker, marker.band])).toEqual([
      ['alt', 'AT_OR_ABOVE_TRAINING_MIDPOINT'],
      ['creatinine', 'BELOW_TRAINING_MIDPOINT'],
    ]);
    expect(result.summary).toMatchObject({
      ageBand: '40-49',
      focusArea: 'LIVER',
      lifestyleFactors: ['HIGH_ALCOHOL'],
      markerCount: 2,
      runName: 'Synthetic result sample',
    });
    expect(result.artifacts).toEqual([
      {
        category: 'RESULT',
        contentType: 'application/json',
        displayName: resultFileName(jobId),
        id: rows.artifacts[0]?.id,
        kind: 'RESULT',
        sizeBytes: Buffer.byteLength(JSON.stringify(file, null, 2)),
        viewable: false,
        viewNote: null,
      },
    ]);
    expect(result.references).toEqual([
      { href: '/help#results', label: 'Guide: reading a result' },
    ]);
    expect(response.text).not.toContain(context.config.storageRoot);
    expect(response.text).not.toContain('simulateFailure');
  });

  it('stores and returns NO_MATCH when no mock rule matches', async () => {
    mode = 'ok';
    const jobId = await context.completeSmartCheckupJob(
      owner,
      body('KIDNEY', ['POOR_SLEEP'], ['creatinine,0.9,mg/dL', 'systolic_bp,110,mmHg']),
    );
    expect(await jobStatus(jobId)).toBe('COMPLETED');
    const rows = await resultRows(jobId);
    expect(rows.artifacts).toHaveLength(1);
    expect(rows.recommendations).toEqual([
      expect.objectContaining({
        matchedFactors: '[]',
        packageLabel: 'No mock recommendation',
        ruleIdentifier: 'NO_MATCH',
      }),
    ]);
    const response = await owner.get(`/api/v1/jobs/${jobId}/result`);
    expect(response.status).toBe(200);
    expect(response.body.data.recommendation).toMatchObject({
      matched: false,
      matchedFactors: [],
      packageLabel: 'No mock recommendation',
      reason: 'No mock rule matches this input, so no package is recommended.',
      ruleId: 'NO_MATCH',
    });
  });

  it.each([
    ['handler-throws', false],
    ['finalize-throws', true],
  ] as const)(
    '%s → FAILED with the handler summary and no result rows',
    async (failure, fileWritten) => {
      mode = failure;
      try {
        const jobId = await context.completeSmartCheckupJob(
          owner,
          body('LIVER', [], ['alt,300,U/L']),
        );
        expect(await jobStatus(jobId)).toBe('FAILED');
        expect(await resultRows(jobId)).toEqual({ artifacts: [], recommendations: [] });
        // finalize runs after result.json was written; only the rows are transactional.
        expect(context.resultFileExists(jobId)).toBe(fileWritten);
        const detail = await owner.get(`/api/v1/jobs/${jobId}`);
        expect(detail.body.data.failureSummary).toBe(STATUS_SUMMARIES.HANDLER_FAILURE);
        const result = await owner.get(`/api/v1/jobs/${jobId}/result`);
        expect(result.status).toBe(409);
        expect(result.body.error.details).toEqual([{ field: 'status', message: 'FAILED' }]);
        expect(result.body.data).toBeUndefined();
      } finally {
        mode = 'ok';
      }
    },
  );
});

describe('GET /jobs/{id}/result (design C5/C7, US-009)', () => {
  it('answers 409 with the status for every non-COMPLETED status on all endpoints', async () => {
    const smartCheckupId = await context.completeSmartCheckupJob(owner);
    const smartArtifact = await context.prisma.resultArtifact.findFirstOrThrow({
      where: { jobId: smartCheckupId },
    });
    const cases = [
      { artifactId: smartArtifact.id, jobId: smartCheckupId },
      { artifactId: nextflow.outputIds[NEXTFLOW_PATHS.report] ?? '', jobId: nextflow.jobId },
    ];
    try {
      for (const { artifactId, jobId } of cases) {
        for (const status of NOT_COMPLETED) {
          await context.setJobStatus(jobId, status);
          const result = await owner.get(`/api/v1/jobs/${jobId}/result`);
          expect(result.status, `${jobId} ${status}`).toBe(409);
          expect(result.body.error).toMatchObject({
            code: 'CONFLICT',
            details: [{ field: 'status', message: status }],
          });
          expect(result.body.data).toBeUndefined();
          for (const action of ['download', 'view']) {
            const file = await owner.get(`/api/v1/jobs/${jobId}/artifacts/${artifactId}/${action}`);
            expect(file.status, `${action} ${status}`).toBe(409);
            expect(file.headers['content-disposition']).toBeUndefined();
          }
        }
      }
    } finally {
      for (const { jobId } of cases) {
        await context.setJobStatus(jobId, 'COMPLETED');
      }
    }
    expect(await auditEvents('RESULT_DOWNLOADED', smartArtifact.id)).toEqual([]);
  });

  it('answers 404 for a foreign job (audited denial) and a missing job (no audit)', async () => {
    const foreign = await other.get(`/api/v1/jobs/${nextflow.jobId}/result`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'This job is unavailable.',
    });
    const denials = await auditEvents('AUTHORIZATION_DENIED', nextflow.jobId);
    expect(denials).toEqual([
      expect.objectContaining({
        actorId: other.userId,
        outcome: 'DENIED',
        resourceType: 'JOB',
      }),
    ]);
    expect(JSON.parse(denials[0]?.metadataJson ?? '{}')).toEqual({
      method: 'GET',
      route: '/api/v1/jobs/:jobId/result',
    });

    const missing = await owner.get(`/api/v1/jobs/${MISSING_JOB_ID}/result`);
    expect(missing.status).toBe(404);
    // Foreign and missing are indistinguishable to the caller.
    expect(missing.body.error).toEqual(foreign.body.error);
    expect(await auditEvents('AUTHORIZATION_DENIED', MISSING_JOB_ID)).toEqual([]);
  });

  it('answers 410 for an old Smart Checkup job without result rows', async () => {
    const jobId = await context.seedSmartCheckupJob(owner.userId, 'COMPLETED');
    const response = await owner.get(`/api/v1/jobs/${jobId}/result`);
    expect(response.status).toBe(410);
    expect(response.body.error).toMatchObject({ code: 'GONE', message: GONE_MESSAGE });
  });

  it('answers 410 when the Nextflow stats file is not in the manifest or was removed', async () => {
    const withoutStats = await context.seedNextflowJob(
      owner.userId,
      nextflowOutputs(['only_reads']).filter((output) => output.category !== 'STATS'),
    );
    expect((await owner.get(`/api/v1/jobs/${withoutStats.jobId}/result`)).status).toBe(410);

    const removed = await context.seedNextflowJob(owner.userId, nextflowOutputs(['removed']));
    await rm(context.outputPath(removed.jobId, NEXTFLOW_PATHS.stats));
    const response = await owner.get(`/api/v1/jobs/${removed.jobId}/result`);
    expect(response.status).toBe(410);
    expect(response.body.error.message).toBe(GONE_MESSAGE);
  });

  it('answers 500 with a safe message for unreadable JSON or a symlinked result.json', async () => {
    const jobId = await context.completeSmartCheckupJob(owner);
    const path = join(context.jobDirectory(jobId), 'result.json');
    await writeFile(path, '{ not json');
    const broken = await owner.get(`/api/v1/jobs/${jobId}/result`);
    expect(broken.status).toBe(500);
    expect(broken.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Unable to complete the request.',
    });

    const outside = join(context.config.storageRoot, 'outside-result.json');
    await writeFile(outside, '{}');
    await rm(path);
    await symlink(outside, path);
    const linked = await owner.get(`/api/v1/jobs/${jobId}/result`);
    expect(linked.status).toBe(500);
    for (const response of [broken, linked]) {
      expect(response.text).not.toContain(context.config.storageRoot);
      expect(response.text).not.toContain('result.json');
    }
    await rm(outside);
  });

  it('returns the Nextflow result: per-sample stats, totals, artifacts and references', async () => {
    const response = await owner.get(`/api/v1/jobs/${nextflow.jobId}/result`);
    expect(response.status).toBe(200);
    const result = jobResultSchema.parse(response.body.data);
    if (result.pipelineId !== 'wf-renamefastq') {
      throw new Error('Expected a Nextflow result.');
    }
    const outputs = nextflowOutputs(SAMPLES);
    expect(result.samples).toEqual([
      {
        avgLen: 160,
        avgQual: 12.5,
        maxLen: 170,
        minLen: 150,
        numSeqs: 10,
        sample: 'sample_a',
        sumLen: 1600,
      },
      {
        avgLen: 160,
        avgQual: 12.5,
        maxLen: 170,
        minLen: 150,
        numSeqs: 11,
        sample: 'sample_b',
        sumLen: 1600,
      },
    ]);
    expect(result.summary).toEqual({
      outputBytes: outputs.reduce((sum, output) => sum + Buffer.byteLength(output.content), 0),
      outputFileCount: outputs.length,
      runName: 'Synthetic run',
      sampleCount: 2,
      totalBases: 3200,
      totalReads: 21,
    });
    const byName = new Map(result.artifacts.map((artifact) => [artifact.displayName, artifact]));
    expect(byName.size).toBe(outputs.length);
    expect(byName.get(NEXTFLOW_PATHS.report)).toMatchObject({
      category: 'REPORT',
      kind: 'OUTPUT',
      viewable: true,
      viewNote: null,
    });
    expect(byName.get(NEXTFLOW_PATHS.timeline)).toMatchObject({ viewable: true, viewNote: null });
    expect(byName.get(NEXTFLOW_PATHS.dag)).toMatchObject({
      viewable: false,
      viewNote: DOWNLOAD_ONLY_REPORT_NOTE,
    });
    for (const path of [NEXTFLOW_PATHS.stats, NEXTFLOW_PATHS.trace, 'fastq/sample_a.fastq.gz']) {
      expect(byName.get(path)).toMatchObject({ viewable: false, viewNote: null });
    }
    expect(result.references.map((reference) => reference.href)).toEqual([
      '/help#results',
      'https://www.nextflow.io/docs/latest/',
      'https://github.com/si-lol/wf-renamefastq',
    ]);
    expect(response.text).not.toContain(context.config.storageRoot);
  });

  it('answers 410 for a malformed TSV while every file stays downloadable', async () => {
    const malformed = await context.seedNextflowJob(
      owner.userId,
      nextflowOutputs(['bad_stats']).map((output) =>
        output.category === 'STATS'
          ? {
              ...output,
              content: `${statsTsv(['bad_stats'])}x.fastq.gz\tFASTQ\tDNA\t-1\t0\t0\t0\t0\t0\n`,
            }
          : output,
      ),
    );
    expect((await owner.get(`/api/v1/jobs/${malformed.jobId}/result`)).status).toBe(410);
    for (const id of Object.values(malformed.outputIds)) {
      expect(
        (await owner.get(`/api/v1/jobs/${malformed.jobId}/artifacts/${id}/download`)).status,
      ).toBe(200);
    }
  });
});

describe('GET …/artifacts/{id}/download (design C6, US-011)', () => {
  it('sends the Smart Checkup result as an audited attachment with every header', async () => {
    const jobId = await context.completeSmartCheckupJob(owner);
    const artifact = await context.prisma.resultArtifact.findFirstOrThrow({ where: { jobId } });
    const expected = await readFile(join(context.jobDirectory(jobId), 'result.json'));
    const response = await getBytes(
      owner,
      `/api/v1/jobs/${jobId}/artifacts/${artifact.id}/download`,
    );
    expect(response.status).toBe(200);
    const name = resultFileName(jobId);
    expect(response.headers).toMatchObject({
      'cache-control': 'private, no-store',
      'content-disposition': `attachment; filename="${name}"; filename*=UTF-8''${name}`,
      'content-length': String(expected.length),
      'content-security-policy': DOWNLOAD_CONTENT_SECURITY_POLICY,
      'content-type': 'application/json',
      'x-content-type-options': 'nosniff',
    });
    expect(Buffer.compare(response.body as Buffer, expected)).toBe(0);
    const audit = await auditEvents('RESULT_DOWNLOADED', artifact.id);
    expect(audit).toEqual([
      expect.objectContaining({
        actorId: owner.userId,
        outcome: 'SUCCESS',
        resourceType: 'RESULT',
      }),
    ]);
    expect(JSON.parse(audit[0]?.metadataJson ?? '{}')).toEqual({ artifactId: artifact.id });
  });

  it.each([
    [NEXTFLOW_PATHS.report, 'application/octet-stream'],
    [NEXTFLOW_PATHS.dag, 'application/octet-stream'],
    [NEXTFLOW_PATHS.stats, 'text/tab-separated-values'],
    [NEXTFLOW_PATHS.params, 'text/plain'],
    [NEXTFLOW_PATHS.trace, 'application/octet-stream'],
    ['fastq/sample_a.fastq.gz', 'application/gzip'],
  ])('sends %s as an attachment with %s and the exact bytes', async (relativePath, contentType) => {
    const id = nextflow.outputIds[relativePath] ?? '';
    const auditedBefore = (await auditEvents('RESULT_DOWNLOADED', id)).length;
    const response = await getBytes(
      owner,
      `/api/v1/jobs/${nextflow.jobId}/artifacts/${id}/download`,
    );
    expect(response.status).toBe(200);
    const baseName = relativePath.split('/').at(-1) ?? '';
    expect(response.headers['content-type']).toBe(contentType);
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${baseName}"; filename*=UTF-8''${baseName}`,
    );
    expect(response.headers['content-security-policy']).toBe(DOWNLOAD_CONTENT_SECURITY_POLICY);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    const expected = await readFile(context.outputPath(nextflow.jobId, relativePath));
    expect(Buffer.compare(response.body as Buffer, expected)).toBe(0);
    expect(await auditEvents('RESULT_DOWNLOADED', id)).toHaveLength(auditedBefore + 1);
  });

  it('keeps the synthetic report bytes unchanged in downloads', async () => {
    const dag = await getBytes(
      owner,
      `/api/v1/jobs/${nextflow.jobId}/artifacts/${nextflow.outputIds[NEXTFLOW_PATHS.dag]}/download`,
    );
    expect((dag.body as Buffer).toString('utf8')).toBe(DAG_HTML_EXTERNAL);
    const reads = await getBytes(
      owner,
      `/api/v1/jobs/${nextflow.jobId}/artifacts/${nextflow.outputIds['fastq/sample_b.fastq.gz']}/download`,
    );
    expect(Buffer.compare(reads.body as Buffer, fakeFastqGz('sample_b'))).toBe(0);
  });

  it('answers 404 for an artifact of another job, a foreign owner or a wrong id; none audited', async () => {
    const sibling = await context.seedNextflowJob(owner.userId, nextflowOutputs(['sibling']));
    const siblingStats = sibling.outputIds[NEXTFLOW_PATHS.stats] ?? '';
    const smartJobId = await context.completeSmartCheckupJob(owner);
    const smartArtifact = await context.prisma.resultArtifact.findFirstOrThrow({
      where: { jobId: smartJobId },
    });
    const attempts = [
      // Another job of the same owner, requested under this job's ID.
      [owner, nextflow.jobId, siblingStats],
      [owner, nextflow.jobId, smartArtifact.id],
      [owner, smartJobId, siblingStats],
      // The right pair, but another user.
      [other, sibling.jobId, siblingStats],
      [other, smartJobId, smartArtifact.id],
      // A well-formed but unknown artifact id.
      [owner, sibling.jobId, 'cunknownartifact000000000'],
    ] as const;
    for (const [session, jobId, artifactId] of attempts) {
      const response = await session.get(`/api/v1/jobs/${jobId}/artifacts/${artifactId}/download`);
      expect(response.status, `${jobId}/${artifactId}`).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.headers['content-disposition']).toBeUndefined();
    }
    expect(await auditEvents('RESULT_DOWNLOADED', siblingStats)).toEqual([]);
    expect(await auditEvents('RESULT_DOWNLOADED', smartArtifact.id)).toEqual([]);
    expect((await auditEvents('AUTHORIZATION_DENIED', sibling.jobId)).length).toBe(1);
    expect((await auditEvents('AUTHORIZATION_DENIED', smartJobId)).length).toBe(1);
  });

  it('answers 410 without an audit event for a removed or symlinked file', async () => {
    const seeded = await context.seedNextflowJob(owner.userId, nextflowOutputs(['gone']));
    const readsPath = 'fastq/gone.fastq.gz';
    await rm(context.outputPath(seeded.jobId, readsPath));
    const removedId = seeded.outputIds[readsPath] ?? '';
    const removed = await owner.get(`/api/v1/jobs/${seeded.jobId}/artifacts/${removedId}/download`);
    expect(removed.status).toBe(410);
    expect(removed.body.error).toMatchObject({ code: 'GONE', message: GONE_MESSAGE });

    const statsId = seeded.outputIds[NEXTFLOW_PATHS.stats] ?? '';
    const outside = join(context.config.storageRoot, 'outside-secret.txt');
    await writeFile(outside, 'outside the job directory');
    await rm(context.outputPath(seeded.jobId, NEXTFLOW_PATHS.stats));
    await symlink(outside, context.outputPath(seeded.jobId, NEXTFLOW_PATHS.stats));
    const linked = await owner.get(`/api/v1/jobs/${seeded.jobId}/artifacts/${statsId}/download`);
    expect(linked.status).toBe(410);
    expect(linked.text).not.toContain('outside the job directory');
    expect(await auditEvents('RESULT_DOWNLOADED', removedId)).toEqual([]);
    expect(await auditEvents('RESULT_DOWNLOADED', statsId)).toEqual([]);
    await rm(outside);
  });
});

describe('GET …/artifacts/{id}/view (design C6, US-009 AC5–6)', () => {
  it.each([NEXTFLOW_PATHS.report, NEXTFLOW_PATHS.timeline])(
    'serves %s as sandboxed HTML, byte for byte, without an audit event',
    async (relativePath) => {
      const id = nextflow.outputIds[relativePath] ?? '';
      const auditedBefore = (await auditEvents('RESULT_DOWNLOADED', id)).length;
      const response = await getBytes(owner, `/api/v1/jobs/${nextflow.jobId}/artifacts/${id}/view`);
      expect(response.status).toBe(200);
      const baseName = relativePath.split('/').at(-1) ?? '';
      expect(response.headers).toMatchObject({
        'cache-control': 'private, no-store',
        'content-disposition': `inline; filename="${baseName}"`,
        'content-security-policy': VIEW_CONTENT_SECURITY_POLICY,
        'content-type': 'text/html; charset=utf-8',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'SAMEORIGIN',
      });
      const csp = String(response.headers['content-security-policy']);
      expect(csp.startsWith('sandbox allow-scripts;')).toBe(true);
      expect(csp).not.toContain('allow-same-origin');
      const expected = await readFile(context.outputPath(nextflow.jobId, relativePath));
      expect(Buffer.compare(response.body as Buffer, expected)).toBe(0);
      expect((response.body as Buffer).toString('utf8')).toContain('<script>document.body');
      expect(await auditEvents('RESULT_DOWNLOADED', id)).toHaveLength(auditedBefore);
    },
  );

  it('answers 404 for the DAG report and every non-report file', async () => {
    const smartJobId = await context.completeSmartCheckupJob(owner);
    const smartArtifact = await context.prisma.resultArtifact.findFirstOrThrow({
      where: { jobId: smartJobId },
    });
    const attempts = [
      ...[
        NEXTFLOW_PATHS.dag,
        NEXTFLOW_PATHS.stats,
        NEXTFLOW_PATHS.trace,
        NEXTFLOW_PATHS.params,
        'fastq/sample_a.fastq.gz',
      ].map((path) => [nextflow.jobId, nextflow.outputIds[path] ?? ''] as const),
      [smartJobId, smartArtifact.id] as const,
    ];
    for (const [jobId, artifactId] of attempts) {
      const response = await owner.get(`/api/v1/jobs/${jobId}/artifacts/${artifactId}/view`);
      expect(response.status, artifactId).toBe(404);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.text).not.toContain('<script');
    }
  });

  it('does not serve a viewable report of a foreign owner', async () => {
    const id = nextflow.outputIds[NEXTFLOW_PATHS.report] ?? '';
    const response = await other.get(`/api/v1/jobs/${nextflow.jobId}/artifacts/${id}/view`);
    expect(response.status).toBe(404);
    expect(response.text).not.toContain(REPORT_HTML_INLINE_SCRIPT);
  });
});

describe('protected-route chain (design C7)', () => {
  it('requires a session (401) and a completed password change (403)', async () => {
    const id = nextflow.outputIds[NEXTFLOW_PATHS.report] ?? '';
    const paths = [
      `/api/v1/jobs/${nextflow.jobId}/result`,
      `/api/v1/jobs/${nextflow.jobId}/artifacts/${id}/download`,
      `/api/v1/jobs/${nextflow.jobId}/artifacts/${id}/view`,
    ];
    const anonymous = createSession(context.app);
    await context.createUser('results-pending@example.test', 'USER');
    const pending = createSession(context.app);
    expect((await pending.login('results-pending@example.test', TEST_PASSWORD)).status).toBe(200);
    for (const path of paths) {
      const unauthenticated = await anonymous.get(path);
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.body.error.code).toBe('AUTHENTICATION_REQUIRED');
      const gated = await pending.get(path);
      expect(gated.status).toBe(403);
      expect(gated.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
  });
});
