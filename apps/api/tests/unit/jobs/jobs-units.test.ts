import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validateInputFile } from '../../../src/modules/jobs/input-validator.js';
import { createJobStorage, InvalidJobIdError } from '../../../src/modules/jobs/job-storage.js';
import { ALLOWED_TRANSITIONS, isAllowedTransition } from '../../../src/modules/jobs/job.service.js';
import { SAMPLE_INPUT } from '../../../src/modules/jobs/sample-input.js';

const HEADER = 'marker,value,unit';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('validateInputFile (US-004)', () => {
  it('accepts the authored sample and returns typed rows', () => {
    const result = validateInputFile(SAMPLE_INPUT.file.name, SAMPLE_INPUT.file.content);

    expect(result.ok).toBe(true);
    expect(result.ok && result.rows).toHaveLength(10);
    expect(result.ok && result.rows[1]).toEqual({ marker: 'hba1c', unit: '%', value: 5.9 });
  });

  it.each([
    ['../escape.csv', 'UNSAFE_FILENAME'],
    ['dir/input.csv', 'UNSAFE_FILENAME'],
    ['dir\\input.csv', 'UNSAFE_FILENAME'],
    ['.hidden.csv', 'UNSAFE_FILENAME'],
    ['nul\u0000.csv', 'UNSAFE_FILENAME'],
    ['input.xlsx', 'UNSUPPORTED_TYPE'],
  ])('rejects the file name %j with %s', (name, code) => {
    const result = validateInputFile(name, csv('bmi,22,kg/m2'));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]?.code).toBe(code);
    expect(!result.ok && result.unsafeFilename).toBe(code === 'UNSAFE_FILENAME');
  });

  it.each([
    ['empty file', '', 'FILE_EMPTY'],
    ['oversized file', `${HEADER}\n${'x'.repeat(65_537)}`, 'FILE_TOO_LARGE'],
    ['control characters', csv('bmi,22,kg/m2\u0007'), 'INVALID_ENCODING'],
    ['replacement characters', csv('bmi,22\uFFFD,kg/m2'), 'INVALID_ENCODING'],
    ['wrong header', 'marker,value\nbmi,22', 'INVALID_HEADER'],
    ['header only', `${HEADER}\n`, 'ROW_COUNT'],
    ['too many rows', csv(...Array.from({ length: 51 }, () => 'bmi,22,kg/m2')), 'ROW_COUNT'],
    ['extra column', csv('bmi,22,kg/m2,extra'), 'INVALID_ROW'],
    ['quoted cell', csv('"bmi",22,kg/m2'), 'INVALID_ROW'],
    ['formula prefix', csv('=cmd,22,kg/m2'), 'FORMULA_PREFIX'],
    ['negative number', csv('bmi,-22,kg/m2'), 'FORMULA_PREFIX'],
    ['unknown marker', csv('patient_name,22,kg/m2'), 'UNKNOWN_MARKER'],
    ['duplicate marker', csv('bmi,22,kg/m2', 'bmi,23,kg/m2'), 'DUPLICATE_MARKER'],
    ['non-numeric value', csv('bmi,abc,kg/m2'), 'INVALID_VALUE'],
    ['exponent value', csv('bmi,2e1,kg/m2'), 'INVALID_VALUE'],
    ['out of range', csv('bmi,90,kg/m2'), 'OUT_OF_RANGE'],
    ['unit mismatch', csv('bmi,22,lb'), 'UNIT_MISMATCH'],
  ])('rejects %s', (_label, content, code) => {
    const result = validateInputFile('input.csv', content);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((issue) => issue.code)).toContain(code);
  });

  it('never echoes file content in issue messages', () => {
    const result = validateInputFile('input.csv', csv('secret_marker_value,77,kg/m2'));

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret_marker_value');
  });

  it('accepts CRLF line endings, a BOM and trailing blank lines', () => {
    expect(validateInputFile('a.CSV', `\uFEFF${HEADER}\r\nbmi,22.5,kg/m2\r\n\r\n`).ok).toBe(true);
  });
});

describe('job status machine (US-007 AC4)', () => {
  it('allows only QUEUED→RUNNING, RUNNING→COMPLETED|FAILED and QUEUED|RUNNING→CANCELLED', () => {
    const statuses = Object.keys(ALLOWED_TRANSITIONS) as (keyof typeof ALLOWED_TRANSITIONS)[];
    const allowed = statuses.flatMap((from) =>
      statuses.filter((to) => isAllowedTransition(from, to)).map((to) => `${from}->${to}`),
    );

    expect(allowed.sort()).toEqual([
      'QUEUED->CANCELLED',
      'QUEUED->RUNNING',
      'RUNNING->CANCELLED',
      'RUNNING->COMPLETED',
      'RUNNING->FAILED',
    ]);
  });
});

describe('job storage boundary (US-005 AC4)', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'jobs-storage-'));
  });

  afterAll(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('keeps every path inside STORAGE_ROOT/jobs/{jobId} and stores relative keys', async () => {
    const storage = createJobStorage(root);
    const jobId = 'cmgq1z3b40000abcd1234efgh';

    await storage.writeInput(jobId, 'content');

    expect(storage.jobFile(jobId, 'input.csv').startsWith(join(root, 'jobs', jobId))).toBe(true);
    expect(storage.storageKey(jobId, 'input.csv')).toBe(`jobs/${jobId}/input.csv`);
    expect(await storage.readInput(jobId)).toBe('content');
    expect(await storage.listJobIds()).toEqual([jobId]);
    expect(await storage.checkWritable()).toBe(true);

    await storage.removeJob(jobId);
    expect(await storage.listJobIds()).toEqual([]);
  });

  it.each(['../outside', 'jobs/../../x', 'UPPERCASE00000000000000000', ''])(
    'rejects the job ID %j',
    (jobId) => {
      expect(() => createJobStorage(root).jobDirectory(jobId)).toThrow(InvalidJobIdError);
    },
  );

  it('rejects file names that leave the job directory', () => {
    expect(() => createJobStorage(root).jobFile('cmgq1z3b40000abcd1234efgh', '../x')).toThrow();
  });
});
