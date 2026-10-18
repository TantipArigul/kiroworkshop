import { describe, expect, it } from 'vitest';

import {
  buildInputPreview,
  buildSheetPreview,
  relativePathOf,
  type SelectedFile,
} from './inputPreview';

const MB = 1_048_576;
const files = (...paths: string[]): SelectedFile[] =>
  paths.map((relativePath) => ({ relativePath, size: 100 }));

describe('relativePathOf', () => {
  it('prefers webkitRelativePath for folder selections', () => {
    const file = new File(['@r\nA\n+\nI\n'], 'a.fastq');

    expect(relativePathOf(file)).toBe('a.fastq');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'run/barcode01/a.fastq' });
    expect(relativePathOf(file)).toBe('run/barcode01/a.fastq');
  });
});

describe('buildInputPreview (client validation with the shared rules, US-017 AC5)', () => {
  it('returns an empty preview for no selection', () => {
    expect(buildInputPreview('SINGLE_FILE', [])).toMatchObject({
      detectedLayout: null,
      fileCount: 0,
      issues: [],
      uploadPaths: [],
    });
  });

  it('summarises a single file', () => {
    expect(buildInputPreview('SINGLE_FILE', files('reads.fastq.gz'))).toEqual({
      barcodes: [],
      detectedLayout: 'SINGLE_FILE',
      fileCount: 1,
      ignoredCount: 0,
      issues: [],
      skippedCount: 0,
      totalBytes: 100,
      uploadPaths: ['reads.fastq.gz'],
    });
  });

  it('reports a wrong extension for a single file instead of dropping it', () => {
    const preview = buildInputPreview('SINGLE_FILE', files('reads.txt'));

    expect(preview.issues).toEqual(['Only .fastq, .fq, .fastq.gz and .fq.gz files are accepted.']);
    expect(preview.uploadPaths).toEqual([]);
  });

  it('skips non-FASTQ files and ignores unclassified in folder selections (Add-on Wave 2)', () => {
    const preview = buildInputPreview(
      'BARCODE_FOLDERS',
      files(
        'run/.DS_Store',
        'run/barcode02/b.fastq.gz',
        'run/barcode01/a.fastq.gz',
        'run/barcode01/notes.txt',
        'run/unclassified/u.fastq.gz',
      ),
    );

    expect(preview).toMatchObject({
      barcodes: ['barcode01', 'barcode02'],
      detectedLayout: 'BARCODE_FOLDERS',
      fileCount: 2,
      ignoredCount: 1,
      issues: [],
      skippedCount: 2,
      totalBytes: 200,
      uploadPaths: ['run/barcode02/b.fastq.gz', 'run/barcode01/a.fastq.gz'],
    });
  });

  it('shows the detected layout when it does not match the chosen input type', () => {
    const preview = buildInputPreview('SAMPLE_FOLDER', files('run/barcode01/a.fastq'));

    expect(preview.detectedLayout).toBe('BARCODE_FOLDERS');
    expect(preview.issues).toEqual(['The selected files do not match the chosen input type.']);
  });

  it('flags more than 10 FASTQ files and more than 1 GB in total', () => {
    const many = buildInputPreview(
      'SAMPLE_FOLDER',
      files(...Array.from({ length: 11 }, (_, index) => `run/r${index}.fastq`)),
    );
    const large = buildInputPreview('SINGLE_FILE', [
      { relativePath: 'big.fastq.gz', size: 1024 * MB + 1 },
    ]);

    expect(many.issues).toEqual(['Select at most 10 FASTQ files (11 selected).']);
    expect(large.issues).toEqual(['The FASTQ files must be 1 GB or smaller in total.']);
  });

  it('never puts a path into an issue message', () => {
    const preview = buildInputPreview('SAMPLE_FOLDER', files('patient-smith/../a.fastq'));

    expect(preview.issues).toHaveLength(1);
    expect(preview.issues.join(' ')).not.toContain('patient');
  });
});

describe('buildSheetPreview (P9 in the browser)', () => {
  it('matches the sheet barcodes with the folder barcodes', () => {
    expect(
      buildSheetPreview('barcode,alias\nbarcode01,s01\nbarcode02,s02', ['barcode01', 'barcode02']),
    ).toEqual({
      issues: [],
      match: { missingFolders: [], ok: true, unlistedFolders: [] },
      rows: [
        { alias: 's01', barcode: 'barcode01', line: 2 },
        { alias: 's02', barcode: 'barcode02', line: 3 },
      ],
    });
    expect(buildSheetPreview('barcode,alias\nbarcode01,s01', ['barcode02']).match).toEqual({
      missingFolders: ['barcode01'],
      ok: false,
      unlistedFolders: ['barcode02'],
    });
  });

  it('has no match until folders are selected, and returns parse issues with lines', () => {
    expect(buildSheetPreview('barcode,alias\nbarcode01,s01', []).match).toBeNull();
    expect(buildSheetPreview('barcode,alias\nbarcode01,bad alias', ['barcode01'])).toMatchObject({
      issues: [{ code: 'INVALID_ALIAS', line: 2 }],
      match: null,
      rows: [],
    });
  });
});
