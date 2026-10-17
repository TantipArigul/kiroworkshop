import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { pathSegmentGenerator, sampleNameGenerator } from '../testing/generators.js';
import {
  checkLaunchRules,
  classifyLayout,
  classifyLayoutAs,
  isFastqFileName,
  isSafePathSegment,
  isValidSampleName,
  matchSheetToFolders,
  normalizeRunName,
  parseSampleSheet,
  splitRelativePath,
  utf8ByteLength,
} from './run-input.js';

const UNSAFE_CHARACTERS = [' ', '"', "'", '`', '$', ';', '|', '/', '\\', '&', '<', '>', '*'];

describe('safe names and path segments', () => {
  it('accepts allowlisted segments and rejects traversal, hidden and unsafe names', () => {
    expect(isSafePathSegment('reads01.fastq.gz')).toBe(true);
    expect(isSafePathSegment('barcode01')).toBe(true);
    expect(isSafePathSegment('..')).toBe(false);
    expect(isSafePathSegment('a..b')).toBe(false);
    expect(isSafePathSegment('.hidden')).toBe(false);
    expect(isSafePathSegment('')).toBe(false);
    expect(isSafePathSegment('a b')).toBe(false);
    expect(isSafePathSegment('x'.repeat(129))).toBe(false);
    expect(splitRelativePath('fastq_pass/barcode01/r.fastq')).toEqual([
      'fastq_pass',
      'barcode01',
      'r.fastq',
    ]);
    expect(splitRelativePath('/abs/r.fastq')).toBeNull();
    expect(splitRelativePath('a/../r.fastq')).toBeNull();
    expect(splitRelativePath('a\\r.fastq')).toBeNull();
    expect(splitRelativePath('a//r.fastq')).toBeNull();
  });

  it('recognises FASTQ extensions only', () => {
    for (const name of ['r.fastq', 'r.fq', 'r.fastq.gz', 'r.fq.gz']) {
      expect(isFastqFileName(name)).toBe(true);
    }

    for (const name of ['r.fastq.zip', 'r.txt', '.fastq', 'r.FASTQ', 'r.gz']) {
      expect(isFastqFileName(name)).toBe(false);
    }
  });

  it('validates run names (trimmed) and sample names', () => {
    expect(normalizeRunName('  Run 1.a_b-c ')).toBe('Run 1.a_b-c');
    expect(normalizeRunName('')).toBeNull();
    expect(normalizeRunName('x'.repeat(65))).toBeNull();
    expect(normalizeRunName('run$1')).toBeNull();
    expect(isValidSampleName('sample_01-A')).toBe(true);
    expect(isValidSampleName('bad alias')).toBe(false);
    expect(isValidSampleName('a$b')).toBe(false);
    expect(isValidSampleName('')).toBe(false);
  });

  it('P10 (partial): accepted names never contain whitespace or shell metacharacters', () => {
    fc.assert(
      fc.property(sampleNameGenerator, (name) => {
        expect(isValidSampleName(name)).toBe(true);
        expect(UNSAFE_CHARACTERS.some((char) => name.includes(char))).toBe(false);
      }),
    );
    fc.assert(
      fc.property(pathSegmentGenerator, (segment) => {
        const safe = isSafePathSegment(segment);
        expect(safe).toBe(!segment.includes('..'));
        if (safe) {
          expect(UNSAFE_CHARACTERS.some((char) => segment.includes(char))).toBe(false);
          expect(segment.startsWith('.')).toBe(false);
        }
      }),
    );
    fc.assert(
      fc.property(fc.string(), (value) => {
        if (isValidSampleName(value)) {
          expect(/\s/.test(value)).toBe(false);
          expect(UNSAFE_CHARACTERS.some((char) => value.includes(char))).toBe(false);
        }
      }),
    );
  });
});

describe('classifyLayout', () => {
  it('classifies the three pipeline layouts', () => {
    expect(classifyLayout(['reads01.fastq.gz'])).toMatchObject({
      layout: 'SINGLE_FILE',
      ok: true,
      rootFolder: null,
    });
    expect(classifyLayout(['fastq_pass/r1.fastq.gz', 'fastq_pass/r2.fq'])).toMatchObject({
      layout: 'SAMPLE_FOLDER',
      ok: true,
      rootFolder: 'fastq_pass',
    });
    expect(
      classifyLayout([
        'fastq_pass/barcode02/r.fastq.gz',
        'fastq_pass/barcode01/r.fastq.gz',
        'fastq_pass/unclassified/u.fastq.gz',
      ]),
    ).toEqual({
      barcodes: ['barcode01', 'barcode02'],
      ignoredPaths: ['fastq_pass/unclassified/u.fastq.gz'],
      layout: 'BARCODE_FOLDERS',
      ok: true,
      rootFolder: 'fastq_pass',
      usedPaths: ['fastq_pass/barcode02/r.fastq.gz', 'fastq_pass/barcode01/r.fastq.gz'],
    });
  });

  it('ignores unclassified next to top-level folder files, like the pipeline', () => {
    expect(
      classifyLayout(['fastq_pass/r1.fastq.gz', 'fastq_pass/unclassified/u.fastq.gz']),
    ).toMatchObject({
      ignoredPaths: ['fastq_pass/unclassified/u.fastq.gz'],
      layout: 'SAMPLE_FOLDER',
      usedPaths: ['fastq_pass/r1.fastq.gz'],
    });
  });

  it.each([
    [[], 'NO_FILES'],
    [['../r.fastq'], 'UNSAFE_PATH'],
    [['dir/r.txt'], 'NOT_FASTQ'],
    [['d/r.fastq', 'd/r.fastq'], 'DUPLICATE_PATH'],
    [['d/barcode01/x/r.fastq'], 'TOO_DEEP'],
    [['a.fastq', 'b.fastq'], 'MULTIPLE_TOP_LEVEL_FILES'],
    [['a.fastq', 'd/b.fastq'], 'MIXED_LAYOUT'],
    [['d/a.fastq', 'd/barcode01/b.fastq'], 'MIXED_LAYOUT'],
    [['d1/a.fastq', 'd2/b.fastq'], 'MULTIPLE_ROOT_FOLDERS'],
    [['d/unclassified/u.fastq'], 'NO_BARCODE_FOLDERS'],
    [['d/sample1/a.fastq'], 'INVALID_BARCODE_FOLDER'],
    [['d/barcode1/a.fastq'], 'INVALID_BARCODE_FOLDER'],
  ] as const)('rejects %j with %s', (paths, code) => {
    expect(classifyLayout(paths)).toMatchObject({ code, ok: false });
  });

  it('checks the detected layout against the chosen one', () => {
    expect(classifyLayoutAs('SAMPLE_FOLDER', ['r.fastq'])).toMatchObject({
      code: 'LAYOUT_MISMATCH',
      ok: false,
    });
    expect(classifyLayoutAs('SINGLE_FILE', ['r.fastq'])).toMatchObject({ ok: true });
  });

  it('never echoes paths in issue messages', () => {
    const result = classifyLayout(['secret-patient/a.txt']);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret-patient');
  });
});

describe('parseSampleSheet', () => {
  it('parses a valid sheet with BOM, CRLF, extra columns and a trailing newline', () => {
    expect(
      parseSampleSheet('\uFEFFbarcode,alias,type\r\nbarcode01,s01,test\r\nbarcode02,s02,\r\n'),
    ).toEqual({
      ok: true,
      rows: [
        { alias: 's01', barcode: 'barcode01', line: 2 },
        { alias: 's02', barcode: 'barcode02', line: 3 },
      ],
    });
  });

  it.each([
    ['', 'EMPTY', undefined],
    ['alias,barcode\nbarcode01,s1', 'INVALID_HEADER', 1],
    ['"barcode",alias\nbarcode01,s1', 'INVALID_HEADER', 1],
    ['barcode,alias\n', 'NO_ROWS', undefined],
    ['barcode,alias\nbarcode01,bad alias', 'INVALID_ALIAS', 2],
    ['barcode,alias\nbarcode01,a$b', 'INVALID_ALIAS', 2],
    ['barcode,alias\nbc01,s1', 'INVALID_BARCODE', 2],
    ['barcode,alias\nbarcode01,s1\nbarcode01,s2', 'DUPLICATE_BARCODE', 3],
    ['barcode,alias\nbarcode01,s1\nbarcode02,s1', 'DUPLICATE_ALIAS', 3],
    ['barcode,alias\nbarcode01', 'TOO_FEW_COLUMNS', 2],
    ['barcode,alias\nbarcode01,', 'TOO_FEW_COLUMNS', 2],
    ['barcode,alias\nbarcode01,s1\n\nbarcode02,s2', 'EMPTY_ROW', 3],
    ['barcode,alias\nbarcode01,"s1"', 'UNSAFE_CHARACTER', 2],
    ['barcode,alias\nbarcode01,=cmd', 'UNSAFE_CHARACTER', 2],
    ['barcode,alias\nbarcode01,-s1', 'UNSAFE_CHARACTER', 2],
    ['barcode,alias\nbarcode01,s1\tx', 'UNSAFE_CHARACTER', 2],
  ] as const)('rejects %j with %s', (content, code, line) => {
    const result = parseSampleSheet(content);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues).toContainEqual(
      line === undefined
        ? { code, message: expect.any(String) as string }
        : { code, line, message: expect.any(String) as string },
    );
  });

  it('enforces the row and byte limits', () => {
    const rows = Array.from({ length: 97 }, (_, index) => `barcode${index + 10},s${index}`);
    expect(parseSampleSheet(['barcode,alias', ...rows].join('\n'))).toMatchObject({
      issues: [{ code: 'TOO_MANY_ROWS' }],
      ok: false,
    });
    expect(parseSampleSheet(['barcode,alias', ...rows.slice(0, 96)].join('\n')).ok).toBe(true);
    expect(parseSampleSheet(`barcode,alias\nbarcode01,s1,${'x'.repeat(65_536)}`)).toMatchObject({
      issues: [{ code: 'TOO_LARGE' }],
      ok: false,
    });
  });

  it('never echoes aliases in issue messages', () => {
    const result = parseSampleSheet('barcode,alias\nbarcode01,patient smith');
    expect(JSON.stringify(result)).not.toContain('smith');
  });

  it('counts UTF-8 bytes', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('ก')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });
});

describe('matchSheetToFolders', () => {
  it('requires equal barcode sets and ignores unclassified', () => {
    expect(matchSheetToFolders(['barcode01', 'barcode02'], ['barcode02', 'barcode01'])).toEqual({
      missingFolders: [],
      ok: true,
      unlistedFolders: [],
    });
    expect(
      matchSheetToFolders(['barcode01', 'barcode03'], ['barcode01', 'barcode02', 'unclassified']),
    ).toEqual({ missingFolders: ['barcode03'], ok: false, unlistedFolders: ['barcode02'] });
  });

  it('P9 (partial): passes exactly when the sets are equal', () => {
    const barcodes = fc
      .uniqueArray(fc.integer({ min: 1, max: 30 }), { maxLength: 8 })
      .map((n) => n.map((value) => `barcode${String(value).padStart(2, '0')}`));
    fc.assert(
      fc.property(barcodes, barcodes, (sheet, folders) => {
        const equal =
          new Set(sheet).size === new Set(folders).size && sheet.every((b) => folders.includes(b));
        expect(matchSheetToFolders(sheet, folders).ok).toBe(equal);
      }),
    );
  });
});

describe('checkLaunchRules', () => {
  it('applies the layout-specific field rules', () => {
    expect(
      checkLaunchRules({ demultiplex: false, hasSampleSheet: true, layout: 'BARCODE_FOLDERS' }),
    ).toEqual([]);
    expect(
      checkLaunchRules({
        demultiplex: true,
        hasSampleSheet: false,
        layout: 'BARCODE_FOLDERS',
        sampleName: 's1',
      }).map((issue) => `${issue.field}:${issue.code}`),
    ).toEqual([
      'sampleName:NOT_ALLOWED',
      'sampleSheet:REQUIRED',
      'options.demultiplex:NOT_ALLOWED',
    ]);
    expect(
      checkLaunchRules({ demultiplex: true, hasSampleSheet: false, layout: 'SAMPLE_FOLDER' }),
    ).toEqual([]);
    expect(
      checkLaunchRules({ demultiplex: false, hasSampleSheet: true, layout: 'SINGLE_FILE' }).map(
        (issue) => `${issue.field}:${issue.code}`,
      ),
    ).toEqual(['sampleSheet:NOT_ALLOWED']);
  });
});
