import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NEXTFLOW_STATS_HEADER,
  NEXTFLOW_STATS_MAX_BYTES,
  NEXTFLOW_STATS_MAX_ROWS,
  NEXTFLOW_STATS_RELATIVE_PATH,
  parseNextflowStats,
  readNextflowStats,
  sampleNameOf,
} from '../../../src/modules/results/nextflow-stats.js';

// Nextflow Stats Reader (design C4): strict seqkit stats parser for untrusted pipeline output.

const ROW = 'all_fastq/barcode01.fastq.gz\tFASTQ\tDNA\t1200\t1500000\t200\t1250.5\t4000\t17.2';
const tsv = (...rows: string[]) => `${[NEXTFLOW_STATS_HEADER, ...rows].join('\n')}\n`;
const INVALID = { ok: false, reason: 'INVALID' };

describe('parseNextflowStats — valid files', () => {
  it('parses the exact seqkit header and every column of a row', () => {
    expect(NEXTFLOW_STATS_HEADER).toBe(
      'file\tformat\ttype\tnum_seqs\tsum_len\tmin_len\tavg_len\tmax_len\tAvgQual',
    );
    expect(NEXTFLOW_STATS_RELATIVE_PATH).toBe('stats/all_fastq_statistics.tsv');
    expect(parseNextflowStats(tsv(ROW))).toEqual({
      ok: true,
      samples: [
        {
          avgLen: 1250.5,
          avgQual: 17.2,
          maxLen: 4000,
          minLen: 200,
          numSeqs: 1200,
          sample: 'barcode01',
          sumLen: 1_500_000,
        },
      ],
    });
  });

  it('accepts CRLF, no trailing newline, a header-only file and zero counts', () => {
    expect(parseNextflowStats(`${NEXTFLOW_STATS_HEADER}\r\n${ROW}\r\n`).ok).toBe(true);
    expect(parseNextflowStats(`${NEXTFLOW_STATS_HEADER}\n${ROW}`).ok).toBe(true);
    expect(parseNextflowStats(`${NEXTFLOW_STATS_HEADER}\n`)).toEqual({ ok: true, samples: [] });
    expect(
      parseNextflowStats(tsv('all_fastq/empty.fastq.gz\tFASTQ\tDNA\t0\t0\t0\t0.0\t0\t0')),
    ).toMatchObject({ ok: true, samples: [{ numSeqs: 0, sample: 'empty' }] });
  });

  it('keeps row order and strips the FASTQ suffix from the basename', () => {
    const result = parseNextflowStats(
      tsv(
        ROW,
        'x/y/sample_b.fq.gz\tFASTQ\tDNA\t1\t2\t2\t2\t2\t9',
        'sample_c.fastq\tFASTQ\tDNA\t1\t2\t2\t2\t2\t9',
        'sample_d.fq\tFASTQ\tDNA\t1\t2\t2\t2\t2\t9',
      ),
    );
    expect(result.ok && result.samples.map((sample) => sample.sample)).toEqual([
      'barcode01',
      'sample_b',
      'sample_c',
      'sample_d',
    ]);
  });

  it('accepts exactly the row limit', () => {
    const rows = Array.from({ length: NEXTFLOW_STATS_MAX_ROWS }, (_, index) =>
      ROW.replace('barcode01', `s${index}`),
    );
    const result = parseNextflowStats(tsv(...rows));
    expect(result.ok && result.samples.length).toBe(NEXTFLOW_STATS_MAX_ROWS);
  });
});

describe('parseNextflowStats — invalid files are rejected whole', () => {
  it.each([
    ['empty content', ''],
    ['wrong header', tsv(ROW).replace('AvgQual', 'avg_qual')],
    ['header with extra column', tsv(ROW).replace('AvgQual', 'AvgQual\textra')],
    ['space separated', tsv(ROW.replace(/\t/g, ' '))],
    ['too few columns', tsv(ROW.split('\t').slice(0, 8).join('\t'))],
    ['too many columns', tsv(`${ROW}\t1`)],
    ['empty column', tsv(ROW.replace('\tDNA\t', '\t\t'))],
    ['negative count', tsv(ROW.replace('\t1200\t', '\t-1\t'))],
    ['decimal count', tsv(ROW.replace('\t1200\t', '\t12.5\t'))],
    ['exponent', tsv(ROW.replace('\t17.2', '\t1e3'))],
    ['NaN', tsv(ROW.replace('\t17.2', '\tNaN'))],
    ['Infinity', tsv(ROW.replace('\t17.2', '\tInfinity'))],
    ['comma thousands', tsv(ROW.replace('\t1500000\t', '\t1,500,000\t'))],
    ['16-digit integer', tsv(ROW.replace('\t1500000\t', '\t1234567890123456\t'))],
    ['blank line between rows', `${NEXTFLOW_STATS_HEADER}\n${ROW}\n\n${ROW}\n`],
    ['control character in file name', tsv(ROW.replace('barcode01', 'bar\u0007code'))],
    ['file name that leaves no sample', tsv(ROW.replace('all_fastq/barcode01.fastq.gz', 'x/'))],
    ['sample longer than 400 characters', tsv(ROW.replace('barcode01', 'a'.repeat(401)))],
    ['one malformed row among valid ones', tsv(ROW, ROW.replace('\t4000\t', '\tfour\t'), ROW)],
  ])('%s', (_name, content) => {
    expect(parseNextflowStats(content)).toEqual(INVALID);
  });

  it('rejects more rows than the limit and more bytes than 1 MiB', () => {
    const rows = Array.from({ length: NEXTFLOW_STATS_MAX_ROWS + 1 }, () => ROW);
    expect(parseNextflowStats(tsv(...rows))).toEqual(INVALID);
    expect(NEXTFLOW_STATS_MAX_BYTES).toBe(1_048_576);
    const padded = `${tsv(ROW)}${' '.repeat(NEXTFLOW_STATS_MAX_BYTES)}`;
    expect(parseNextflowStats(padded)).toEqual(INVALID);
  });
});

describe('sampleNameOf', () => {
  it.each([
    ['all_fastq/barcode18.fastq.gz', 'barcode18'],
    ['a.fq.gz', 'a'],
    ['a.fastq', 'a'],
    ['a.fq', 'a'],
    ['dir/a.txt', 'a.txt'],
    ['.fastq.gz', null],
    ['dir/', null],
    [`${'b'.repeat(400)}.fq`, 'b'.repeat(400)],
    [`${'b'.repeat(401)}.fq`, null],
  ])('%s → %s', (file, expected) => {
    expect(sampleNameOf(file)).toBe(expected);
  });
});

describe('readNextflowStats', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'results-stats-'));
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('reads a regular file', async () => {
    const path = join(directory, 'ok.tsv');
    await writeFile(path, tsv(ROW));
    expect(await readNextflowStats(path)).toMatchObject({ ok: true, samples: [{ numSeqs: 1200 }] });
  });

  it('reports MISSING for an absent file and INVALID for bad content', async () => {
    expect(await readNextflowStats(join(directory, 'absent.tsv'))).toEqual({
      ok: false,
      reason: 'MISSING',
    });
    const path = join(directory, 'bad.tsv');
    await writeFile(path, 'not a stats file\n');
    expect(await readNextflowStats(path)).toEqual(INVALID);
  });

  it('never follows a symlink and rejects directories and oversized files', async () => {
    const target = join(directory, 'target.tsv');
    await writeFile(target, tsv(ROW));
    const link = join(directory, 'link.tsv');
    await symlink(target, link);
    expect(await readNextflowStats(link)).toEqual(INVALID);
    const folder = join(directory, 'folder.tsv');
    await mkdir(folder);
    expect(await readNextflowStats(folder)).toEqual(INVALID);
    const big = join(directory, 'big.tsv');
    await writeFile(big, Buffer.alloc(NEXTFLOW_STATS_MAX_BYTES + 1, 0x20));
    expect(await readNextflowStats(big)).toEqual(INVALID);
  });
});
