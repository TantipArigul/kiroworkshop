import { describe, expect, it } from 'vitest';

import {
  validateLaunch,
  type ReceivedRunUpload,
} from '../../../src/modules/pipelines/run-input-validator.js';

const OPTIONS = JSON.stringify({});
const fastq = (...paths: string[]) =>
  paths.map((relativePath) => ({ relativePath, sizeBytes: 10 }));
const sheet = (content: string) => ({ content, sizeBytes: content.length });

function upload(overrides: Partial<ReceivedRunUpload> = {}): ReceivedRunUpload {
  return {
    fastqFiles: fastq('reads.fastq.gz'),
    fields: { layout: 'SINGLE_FILE', options: OPTIONS, runName: 'Run 1' },
    sampleSheet: null,
    ...overrides,
  };
}

function fieldsOf(result: ReturnType<typeof validateLaunch>) {
  return result.ok ? [] : result.issues.map((issue) => `${issue.field}:${issue.code}`);
}

describe('validateLaunch (C4, US-017/US-018)', () => {
  it('accepts a single file with an optional sample name and computes the input summary', () => {
    const result = validateLaunch(
      upload({
        fields: {
          layout: 'SINGLE_FILE',
          options: JSON.stringify({ qScore: 20 }),
          runName: '  Run 1  ',
          sampleName: 'sample_01',
        },
      }),
    );

    expect(result).toEqual({
      input: {
        barcodes: [],
        fastqRoot: 'fastq/reads.fastq.gz',
        fileCount: 1,
        files: [{ kind: 'FASTQ', relativePath: 'fastq/reads.fastq.gz', sizeBytes: 10 }],
        layout: 'SINGLE_FILE',
        options: {
          demultiplex: false,
          kitName: 'BiK-HLA114-96',
          qScore: 20,
          qualityFilter: true,
        },
        runName: 'Run 1',
        sampleName: 'sample_01',
        totalBytes: 10,
      },
      ok: true,
    });
  });

  it('accepts a sample folder with demultiplexing and points the run at the folder', () => {
    const result = validateLaunch(
      upload({
        fastqFiles: fastq('fastq_pass/a.fastq.gz', 'fastq_pass/b.fq'),
        fields: {
          layout: 'SAMPLE_FOLDER',
          options: JSON.stringify({ demultiplex: true }),
          runName: 'Folder run',
        },
      }),
    );

    expect(result.ok && result.input).toMatchObject({
      fastqRoot: 'fastq/fastq_pass',
      fileCount: 2,
      layout: 'SAMPLE_FOLDER',
      sampleName: null,
      totalBytes: 20,
    });
  });

  it('accepts barcode folders with a matching sheet and records the sheet as an input file', () => {
    const result = validateLaunch(
      upload({
        fastqFiles: fastq('run/barcode01/a.fastq.gz', 'run/barcode02/b.fastq.gz'),
        fields: { layout: 'BARCODE_FOLDERS', options: OPTIONS, runName: 'Barcodes' },
        sampleSheet: sheet('barcode,alias\nbarcode01,s01\nbarcode02,s02\n'),
      }),
    );

    expect(result.ok && result.input.barcodes).toEqual(['barcode01', 'barcode02']);
    expect(result.ok && result.input.fastqRoot).toBe('fastq/run');
    expect(result.ok && result.input.files.at(-1)).toEqual({
      kind: 'SAMPLE_SHEET',
      relativePath: 'sample_sheet.csv',
      sizeBytes: 'barcode,alias\nbarcode01,s01\nbarcode02,s02\n'.length,
    });
  });

  it.each([
    ['run name with $', { runName: 'run$1' }, 'runName:INVALID_VALUE'],
    ['empty run name', { runName: '   ' }, 'runName:INVALID_VALUE'],
    ['sample name with a space', { sampleName: 'bad alias' }, 'sampleName:INVALID_VALUE'],
    ['unknown layout', { layout: 'ZIP' }, 'layout:INVALID_VALUE'],
    ['unknown field', { extra: 'x' }, 'fields:UNEXPECTED_FIELD'],
    ['options not JSON', { options: '{' }, 'options:INVALID_VALUE'],
    ['unknown option', { options: '{"resume":true}' }, 'options:INVALID_VALUE'],
    ['Q-score out of range', { options: '{"qScore":61}' }, 'options:INVALID_VALUE'],
  ])('rejects %s', (_label, fields, expected) => {
    const result = validateLaunch(
      upload({
        fields: { layout: 'SINGLE_FILE', options: OPTIONS, runName: 'Run 1', ...fields },
      }),
    );

    expect(result.ok).toBe(false);
    expect(fieldsOf(result).join(' ')).toContain(expected.split(':')[0]);
  });

  it('rejects a layout mismatch, mixed or deep paths on the files field', () => {
    expect(
      fieldsOf(validateLaunch(upload({ fastqFiles: fastq('d/a.fastq', 'd/b.fastq') }))),
    ).toEqual(['files:LAYOUT_MISMATCH']);
    expect(
      fieldsOf(
        validateLaunch(
          upload({
            fastqFiles: fastq('d/a.fastq', 'd/barcode01/b.fastq'),
            fields: { layout: 'SAMPLE_FOLDER', options: OPTIONS, runName: 'r' },
          }),
        ),
      ),
    ).toEqual(['files:MIXED_LAYOUT']);
  });

  it('requires a sheet and forbids demultiplex and sample name for barcode folders (US-017 AC4)', () => {
    const result = validateLaunch(
      upload({
        fastqFiles: fastq('run/barcode01/a.fastq.gz'),
        fields: {
          layout: 'BARCODE_FOLDERS',
          options: JSON.stringify({ demultiplex: true }),
          runName: 'Barcodes',
          sampleName: 's1',
        },
      }),
    );

    expect(fieldsOf(result)).toEqual([
      'sampleName:NOT_ALLOWED',
      'sampleSheet:REQUIRED',
      'options.demultiplex:NOT_ALLOWED',
    ]);
  });

  it('rejects a sheet for single files and a sheet that does not match the folders (P9)', () => {
    expect(fieldsOf(validateLaunch(upload({ sampleSheet: sheet('barcode,alias\nb,c') })))).toEqual([
      'sampleSheet:NOT_ALLOWED',
    ]);

    const mismatch = validateLaunch(
      upload({
        fastqFiles: fastq('run/barcode01/a.fastq.gz', 'run/barcode02/b.fastq.gz'),
        fields: { layout: 'BARCODE_FOLDERS', options: OPTIONS, runName: 'Barcodes' },
        sampleSheet: sheet('barcode,alias\nbarcode01,s01\nbarcode03,s03'),
      }),
    );

    expect(fieldsOf(mismatch)).toEqual(['sampleSheet:SHEET_MISMATCH']);
    expect(JSON.stringify(mismatch)).not.toContain('barcode03');
  });

  it('reports sheet lines without echoing aliases (US-018 AC5)', () => {
    const result = validateLaunch(
      upload({
        fastqFiles: fastq('run/barcode01/a.fastq.gz'),
        fields: { layout: 'BARCODE_FOLDERS', options: OPTIONS, runName: 'Barcodes' },
        sampleSheet: sheet('barcode,alias\nbarcode01,patient smith$'),
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues).toEqual([
      {
        code: 'INVALID_ALIAS',
        field: 'sampleSheet.line 2',
        line: 2,
        message: expect.any(String) as string,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('smith');
  });
});
