import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TransactionClient } from '../../../src/modules/jobs/executor.js';
import { createJobStorage, type JobStorage } from '../../../src/modules/jobs/job-storage.js';
import {
  OutputManifestError,
  recordOutputs,
} from '../../../src/modules/pipelines/pipeline-run.service.js';

const JOB_ID = 'coutputmanifest0000000000';
const REQUIRED = ['fastq/*.fastq.gz', 'stats/all_fastq_statistics.tsv'];

type OutputRow = {
  category: string;
  contentType: string;
  jobId: string;
  relativePath: string;
  sizeBytes: number;
};

let root: string;
let storage: JobStorage;
let output: string;
let rows: OutputRow[];
let tx: TransactionClient;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'portal-outputs-'));
  storage = createJobStorage(root);
  output = storage.jobSubdirectory(JOB_ID, 'output');
  rows = [];
  // Only the call the manifest writer makes inside the COMPLETED transaction.
  tx = {
    jobOutputFile: {
      createMany: ({ data }: { data: OutputRow[] }) => {
        rows.push(...data);
        return Promise.resolve({ count: data.length });
      },
    },
  } as unknown as TransactionClient;
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

async function put(relativePath: string, content = 'x') {
  const target = join(output, relativePath);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content);
}

describe('recordOutputs (C5 output manifest for Results & Guidance)', () => {
  it('records every regular file with category and content type, sorted by path', async () => {
    await put('fastq/s01.fastq.gz', 'gz');
    await put('stats/all_fastq_statistics.tsv', 'tsv');
    await put('pipeline_info/execution_report.html');
    await put('pipeline_info/params.json');
    await put('pipeline_info/dag.bin');

    await recordOutputs(tx, { jobId: JOB_ID, requiredOutputs: REQUIRED, storage });

    expect(rows).toEqual([
      {
        category: 'READS',
        contentType: 'application/gzip',
        jobId: JOB_ID,
        relativePath: 'fastq/s01.fastq.gz',
        sizeBytes: 2,
      },
      {
        category: 'OTHER',
        contentType: 'application/octet-stream',
        jobId: JOB_ID,
        relativePath: 'pipeline_info/dag.bin',
        sizeBytes: 1,
      },
      {
        category: 'REPORT',
        contentType: 'text/html',
        jobId: JOB_ID,
        relativePath: 'pipeline_info/execution_report.html',
        sizeBytes: 1,
      },
      {
        category: 'OTHER',
        contentType: 'application/json',
        jobId: JOB_ID,
        relativePath: 'pipeline_info/params.json',
        sizeBytes: 1,
      },
      {
        category: 'STATS',
        contentType: 'text/tab-separated-values',
        jobId: JOB_ID,
        relativePath: 'stats/all_fastq_statistics.tsv',
        sizeBytes: 3,
      },
    ]);
  });

  it('does not follow or record symlinks', async () => {
    await put('fastq/s01.fastq.gz');
    await put('stats/all_fastq_statistics.tsv');
    await writeFile(join(root, 'outside.txt'), 'outside');
    await symlink(join(root, 'outside.txt'), join(output, 'link.txt'));
    await symlink(root, join(output, 'linked-dir'));

    await recordOutputs(tx, { jobId: JOB_ID, requiredOutputs: REQUIRED, storage });

    expect(rows.map((row) => row.relativePath)).toEqual([
      'fastq/s01.fastq.gz',
      'stats/all_fastq_statistics.tsv',
    ]);
  });

  it.each([
    ['no output directory', []],
    ['reads without statistics', ['fastq/s01.fastq.gz']],
    ['statistics without reads', ['stats/all_fastq_statistics.tsv']],
    ['reads in a sub-folder only', ['fastq/x/s01.fastq.gz', 'stats/all_fastq_statistics.tsv']],
  ])('throws OutputManifestError for %s and records nothing', async (_label, files) => {
    for (const file of files) {
      await put(file);
    }

    await expect(
      recordOutputs(tx, { jobId: JOB_ID, requiredOutputs: REQUIRED, storage }),
    ).rejects.toBeInstanceOf(OutputManifestError);
    expect(rows).toEqual([]);
  });
});
