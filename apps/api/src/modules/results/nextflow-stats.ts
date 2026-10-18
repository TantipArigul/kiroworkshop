import { lstat, readFile } from 'node:fs/promises';

import type { NextflowResult } from '@portal/shared';

/** Output of wf-renamefastq 1.0.3 read by the result page (relative to `jobs/{id}/output`). */
export const NEXTFLOW_STATS_RELATIVE_PATH = 'stats/all_fastq_statistics.tsv';
/** `seqkit stats -T` header, verified against real wf-renamefastq 1.0.3 output. */
export const NEXTFLOW_STATS_HEADER =
  'file\tformat\ttype\tnum_seqs\tsum_len\tmin_len\tavg_len\tmax_len\tAvgQual';
export const NEXTFLOW_STATS_MAX_BYTES = 1_048_576;
export const NEXTFLOW_STATS_MAX_ROWS = 1000;

const COLUMN_COUNT = 9;
const SAMPLE_MAX_LENGTH = 400;
const INTEGER_PATTERN = /^\d{1,15}$/;
const DECIMAL_PATTERN = /^\d{1,15}(\.\d{1,15})?$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const FASTQ_SUFFIXES = ['.fastq.gz', '.fq.gz', '.fastq', '.fq'] as const;

export type NextflowSample = NextflowResult['samples'][number];

/** Never throws: either every row is valid, or the whole file is rejected (design C4). */
export type NextflowStatsResult =
  { ok: true; samples: NextflowSample[] } | { ok: false; reason: 'MISSING' | 'INVALID' };

/**
 * Strict parser of `stats/all_fastq_statistics.tsv` (untrusted pipeline output): exact header,
 * ≤ 1 MiB, ≤ 1,000 rows, finite non-negative numbers (integers for counts and lengths). Any
 * malformed row rejects the whole file, so a partial table is never shown.
 */
export function parseNextflowStats(content: string): NextflowStatsResult {
  if (Buffer.byteLength(content, 'utf8') > NEXTFLOW_STATS_MAX_BYTES) {
    return _invalid();
  }

  const lines = content.replace(/(\r?\n)+$/, '').split(/\r?\n/);
  const [header, ...rows] = lines;

  if (header !== NEXTFLOW_STATS_HEADER || rows.length > NEXTFLOW_STATS_MAX_ROWS) {
    return _invalid();
  }

  const samples: NextflowSample[] = [];

  for (const row of rows) {
    const sample = _parseRow(row);

    if (!sample) {
      return _invalid();
    }

    samples.push(sample);
  }

  return { ok: true, samples };
}

/**
 * Reads and parses the stats file at a path already confined to the job's output directory.
 * Symlinks and non-regular files are rejected without being followed; errors (which carry
 * absolute paths) are reduced to a reason and never rethrown.
 */
export async function readNextflowStats(absolutePath: string): Promise<NextflowStatsResult> {
  try {
    const stats = await lstat(absolutePath);

    if (!stats.isFile() || stats.size > NEXTFLOW_STATS_MAX_BYTES) {
      return _invalid();
    }

    return parseNextflowStats(await readFile(absolutePath, 'utf8'));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { ok: false, reason: 'MISSING' }
      : _invalid();
  }
}

/** `all_fastq/barcode18.fastq.gz` → `barcode18`; `null` when no sample name remains. */
export function sampleNameOf(file: string): string | null {
  const baseName = file.split('/').at(-1) ?? '';
  const suffix = FASTQ_SUFFIXES.find((candidate) => baseName.endsWith(candidate));
  const sample = suffix ? baseName.slice(0, -suffix.length) : baseName;

  return sample.length > 0 && sample.length <= SAMPLE_MAX_LENGTH ? sample : null;
}

function _parseRow(row: string): NextflowSample | null {
  const columns = row.split('\t');

  if (columns.length !== COLUMN_COUNT || columns.some((column) => column.length === 0)) {
    return null;
  }

  const [file = '', , , numSeqs, sumLen, minLen, avgLen, maxLen, avgQual] = columns;

  if (CONTROL_CHARACTERS.test(file)) {
    return null;
  }

  const sample = sampleNameOf(file);
  const integers = [numSeqs, sumLen, minLen, maxLen].map(_integer);
  const decimals = [avgLen, avgQual].map(_decimal);

  if (sample === null || integers.includes(null) || decimals.includes(null)) {
    return null;
  }

  const [parsedNumSeqs = 0, parsedSumLen = 0, parsedMinLen = 0, parsedMaxLen = 0] =
    integers as number[];
  const [parsedAvgLen = 0, parsedAvgQual = 0] = decimals as number[];

  return {
    avgLen: parsedAvgLen,
    avgQual: parsedAvgQual,
    maxLen: parsedMaxLen,
    minLen: parsedMinLen,
    numSeqs: parsedNumSeqs,
    sample,
    sumLen: parsedSumLen,
  };
}

function _integer(value: string | undefined): number | null {
  if (value === undefined || !INTEGER_PATTERN.test(value)) {
    return null;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : null;
}

function _decimal(value: string | undefined): number | null {
  if (value === undefined || !DECIMAL_PATTERN.test(value)) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function _invalid(): NextflowStatsResult {
  return { ok: false, reason: 'INVALID' };
}
