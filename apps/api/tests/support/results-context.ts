import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { INPUT_FILE_HEADER } from '@portal/shared';

import { createAuditService } from '../../src/modules/audit/audit.service.js';
import type { JobCompletionHandler } from '../../src/modules/jobs/completion.js';
import { createJobStorage } from '../../src/modules/jobs/job-storage.js';
import { createJobService } from '../../src/modules/jobs/job.service.js';
import { createRetentionSweeper, type SweepResult } from '../../src/modules/jobs/retention.js';
import { createJobsTestContext, type JobsTestContext } from './jobs-context.js';

/** Header of seqkit stats `all_fastq_statistics.tsv` (design C4). */
export const STATS_HEADER =
  'file\tformat\ttype\tnum_seqs\tsum_len\tmin_len\tavg_len\tmax_len\tAvgQual';

export type TestSession = Awaited<ReturnType<JobsTestContext['signIn']>>;

export type OutputFixture = {
  relativePath: string;
  category: 'READS' | 'STATS' | 'REPORT' | 'OTHER';
  contentType: string;
  content: string | Buffer;
};

export type ResultsTestContext = JobsTestContext & {
  /** Submits a Smart Checkup job and drives the worker until it is terminal. */
  completeSmartCheckupJob: (
    session: TestSession,
    body?: { parameters: Record<string, unknown>; file: { name: string; content: string } },
  ) => Promise<string>;
  /** Submits a Smart Checkup job without running the worker (it stays QUEUED). */
  submitSmartCheckupJob: (session: TestSession) => Promise<string>;
  /**
   * A COMPLETED wf-renamefastq job seeded directly (no Nextflow process): the job row, its
   * output manifest rows and the files under `jobs/{jobId}/output/`.
   */
  seedNextflowJob: (
    ownerId: string,
    outputs: readonly OutputFixture[],
  ) => Promise<{ jobId: string; outputIds: Record<string, string> }>;
  /** The Foundation 7-day retention sweep with the context's database and storage. */
  sweepRetention: () => Promise<SweepResult>;
  /** Moves the job's expiry into the past. */
  expire: (jobId: string) => Promise<void>;
  resultFileExists: (jobId: string) => boolean;
  /**
   * A Smart Checkup job row seeded directly with the given status and no result rows (e.g. a
   * job completed before Results & Guidance existed). Never ticked by the worker in tests.
   */
  seedSmartCheckupJob: (ownerId: string, status: string) => Promise<string>;
  /** Sets a job's status directly (no transition, no status event) for read-only checks. */
  setJobStatus: (jobId: string, status: string) => Promise<void>;
  /** `jobs/{jobId}/` of the context's storage root. */
  jobDirectory: (jobId: string) => string;
  /** `jobs/{jobId}/output/{relativePath}` of a seeded Nextflow output. */
  outputPath: (jobId: string, relativePath: string) => string;
};

/** Self-contained execution report with an inline script (no external resource). */
export const REPORT_HTML_INLINE_SCRIPT =
  '<!doctype html><html><head><title>Synthetic execution report</title>' +
  '<style>body{font-family:sans-serif}</style></head><body><h1>Report</h1>' +
  '<script>document.body.dataset.rendered = "yes";</script></body></html>';

/** DAG-like report that imports an external script (blocked by the viewer CSP). */
export const DAG_HTML_EXTERNAL =
  '<!doctype html><html><head><title>Synthetic DAG</title>' +
  '<script src="https://cdn.example.test/mermaid.min.js"></script></head>' +
  '<body><pre class="mermaid">flowchart TD; A-->B</pre></body></html>';

/** A gzip-compressed synthetic FASTQ record (not sequencing data). */
export function fakeFastqGz(readName: string): Buffer {
  return gzipSync(Buffer.from(`@${readName}\nACGTACGT\n+\nIIIIIIII\n`, 'utf8'));
}

export const NEXTFLOW_PATHS = {
  dag: 'pipeline_info/pipeline_dag_2026-10-19_10-00-00.html',
  params: 'pipeline_info/params_2026-10-19_10-00-00.yml',
  report: 'pipeline_info/execution_report_2026-10-19_10-00-00.html',
  stats: 'stats/all_fastq_statistics.tsv',
  timeline: 'pipeline_info/execution_timeline_2026-10-19_10-00-00.html',
  trace: 'pipeline_info/execution_trace_2026-10-19_10-00-00.txt',
} as const;

/** The output set of a synthetic wf-renamefastq run: reads per sample, stats and reports. */
export function nextflowOutputs(samples: readonly string[]): OutputFixture[] {
  return [
    ...samples.map((sample) => ({
      category: 'READS' as const,
      content: fakeFastqGz(sample),
      contentType: 'application/gzip',
      relativePath: `fastq/${sample}.fastq.gz`,
    })),
    {
      category: 'STATS',
      content: statsTsv(samples),
      contentType: 'text/tab-separated-values',
      relativePath: NEXTFLOW_PATHS.stats,
    },
    {
      category: 'REPORT',
      content: REPORT_HTML_INLINE_SCRIPT,
      contentType: 'text/html',
      relativePath: NEXTFLOW_PATHS.report,
    },
    {
      category: 'REPORT',
      content: REPORT_HTML_INLINE_SCRIPT.replace('execution report', 'execution timeline'),
      contentType: 'text/html',
      relativePath: NEXTFLOW_PATHS.timeline,
    },
    {
      category: 'REPORT',
      content: DAG_HTML_EXTERNAL,
      contentType: 'text/html',
      relativePath: NEXTFLOW_PATHS.dag,
    },
    {
      category: 'OTHER',
      content: 'task_id\tname\tstatus\n1\tRENAME\tCOMPLETED\n',
      contentType: 'text/plain',
      relativePath: NEXTFLOW_PATHS.trace,
    },
    {
      category: 'OTHER',
      content: 'demultiplex: false\n',
      contentType: 'text/plain',
      relativePath: NEXTFLOW_PATHS.params,
    },
  ];
}

/** Synthetic Smart Checkup input (training values; no personal data). */
export function smartCheckupBody(sampleLabel: string, rows: readonly string[]) {
  return {
    file: { content: [INPUT_FILE_HEADER, ...rows, ''].join('\n'), name: 'synthetic-input.csv' },
    parameters: {
      ageBand: '40-49',
      focusArea: 'CARDIOMETABOLIC',
      lifestyleFactors: ['LOW_ACTIVITY'],
      sampleLabel,
      simulateFailure: false,
    },
  };
}

/** Synthetic seqkit stats TSV for the given sample names. */
export function statsTsv(samples: readonly string[]): string {
  const rows = samples.map(
    (sample, index) =>
      `all_fastq/${sample}.fastq.gz\tFASTQ\tDNA\t${10 + index}\t1600\t150\t160\t170\t12.5`,
  );

  return `${[STATS_HEADER, ...rows].join('\n')}\n`;
}

/**
 * Integration context of the Results & Guidance unit: the Jobs context (simulated executor,
 * default Smart Checkup result builder unless replaced) plus seeding helpers.
 */
export async function createResultsTestContext(
  options: { completionHandler?: JobCompletionHandler; environment?: Record<string, string> } = {},
): Promise<ResultsTestContext> {
  const context = await createJobsTestContext(options);
  const storage = createJobStorage(context.config.storageRoot);

  async function settle(jobId: string): Promise<void> {
    for (let pass = 0; pass < 5; pass += 1) {
      await context.tick();
      const job = await context.prisma.job.findUnique({
        select: { status: true },
        where: { id: jobId },
      });

      if (job && !['QUEUED', 'RUNNING'].includes(job.status)) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async function submit(session: TestSession, body: object): Promise<string> {
    const response = await session.post('/api/v1/jobs', body, {
      'Idempotency-Key': crypto.randomUUID(),
    });

    if (response.status !== 201) {
      throw new Error(`Test submission failed with ${response.status}`);
    }

    return response.body.data.job.id as string;
  }

  return {
    ...context,
    completeSmartCheckupJob: async (session, body) => {
      const jobId = await submit(
        session,
        body ?? smartCheckupBody('Synthetic sample', ['fasting_glucose,108,mg/dL']),
      );
      await settle(jobId);
      return jobId;
    },
    expire: async (jobId) => {
      await context.prisma.job.update({
        data: { expiresAt: new Date(Date.now() - 1000) },
        where: { id: jobId },
      });
    },
    jobDirectory: (jobId) => storage.jobDirectory(jobId),
    outputPath: (jobId, relativePath) =>
      join(storage.jobSubdirectory(jobId, 'output'), relativePath),
    resultFileExists: (jobId) => existsSync(join(storage.jobDirectory(jobId), 'result.json')),
    seedSmartCheckupJob: async (ownerId, status) => {
      const job = await context.prisma.job.create({
        data: {
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          ownerId,
          pipelineId: 'smart-checkup',
          runName: 'Seeded Smart Checkup job',
          status,
        },
      });
      return job.id;
    },
    setJobStatus: async (jobId, status) => {
      await context.prisma.job.update({ data: { status }, where: { id: jobId } });
    },
    seedNextflowJob: async (ownerId, outputs) => {
      const job = await context.prisma.job.create({
        data: {
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          ownerId,
          pipelineId: 'wf-renamefastq',
          pipelineRevision: '1.0.3',
          runName: 'Synthetic run',
          status: 'COMPLETED',
        },
      });
      const outputIds: Record<string, string> = {};

      for (const output of outputs) {
        const path = join(storage.jobSubdirectory(job.id, 'output'), output.relativePath);
        await mkdir(dirname(path), { mode: 0o700, recursive: true });
        await writeFile(path, output.content);
        const row = await context.prisma.jobOutputFile.create({
          data: {
            category: output.category,
            contentType: output.contentType,
            jobId: job.id,
            relativePath: output.relativePath,
            sizeBytes: Buffer.byteLength(output.content),
          },
        });
        outputIds[output.relativePath] = row.id;
      }

      return { jobId: job.id, outputIds };
    },
    submitSmartCheckupJob: (session) =>
      submit(session, smartCheckupBody('Queued sample', ['fasting_glucose,108,mg/dL'])),
    sweepRetention: () => {
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

      return createRetentionSweeper({ audit, jobs, logger, prisma: context.prisma, storage })();
    },
  };
}
