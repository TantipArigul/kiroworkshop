import fc from 'fast-check';

import {
  BARCODE_PATTERN,
  JOB_STATUSES,
  PATH_SEGMENT_PATTERN,
  RENAMEFASTQ_KIT_NAMES,
  RENAMEFASTQ_Q_SCORE_MAX,
  RENAMEFASTQ_Q_SCORE_MIN,
  RUN_INPUT_LAYOUTS,
  SAMPLE_NAME_PATTERN,
  UNCLASSIFIED_FOLDER,
} from '../constants.js';

export const jobStatusGenerator = fc.constantFrom(...JOB_STATUSES);
export const idempotencyKeyGenerator = fc.string({ minLength: 1, maxLength: 64 });
export const retentionTimestampGenerator = fc.date({
  min: new Date('2026-01-01'),
  max: new Date('2030-01-01'),
});
/** Path segments accepted by `PATH_SEGMENT_PATTERN` (may still contain `..`). */
export const pathSegmentGenerator = fc.stringMatching(PATH_SEGMENT_PATTERN);
export const sampleNameGenerator = fc.stringMatching(SAMPLE_NAME_PATTERN);
export const barcodeNameGenerator = fc.stringMatching(BARCODE_PATTERN);

// ---------- Pipeline Catalog generators (P8–P12) ----------

export const runInputLayoutGenerator = fc.constantFrom(...RUN_INPUT_LAYOUTS);

/** Barcode folder names from a small pool so generated sets overlap often. */
export const barcodeGenerator = fc
  .integer({ min: 1, max: 12 })
  .map((value) => `barcode${String(value).padStart(2, '0')}`);

const ROOT_FOLDERS = ['fastq_pass', 'run-1', 'reads'] as const;
const SUB_FOLDERS = [
  'barcode01',
  'barcode02',
  'barcode10',
  UNCLASSIFIED_FOLDER,
  'sample1',
  'barcode1',
] as const;
const FASTQ_NAMES = ['a.fastq', 'b.fq', 'c.fastq.gz', 'd.fq.gz'] as const;

/**
 * Upload path sets with the shapes the pipeline distinguishes (top-level file, files in one
 * folder, barcode sub-folders, `unclassified`) plus the invalid mixes: several roots, mixed
 * depths, non-barcode sub-folders and paths one level too deep. Segments are always safe and
 * names always FASTQ, so the classification rules (not the name rules) decide.
 */
const fastqNameGenerator = fc.constantFrom(...FASTQ_NAMES);
const rootFolderGenerator = fc.constantFrom(...ROOT_FOLDERS);
const uniquePaths = (paths: string[]) => [...new Set(paths)];

/** Any mix of depths 1–4 (mostly invalid: mixed layouts, several roots, too deep). */
const mixedPathSetGenerator = fc
  .array(
    fc.oneof(
      { arbitrary: fastqNameGenerator.map((name) => [name]), weight: 2 },
      { arbitrary: fc.tuple(rootFolderGenerator, fastqNameGenerator), weight: 3 },
      {
        arbitrary: fc.tuple(
          rootFolderGenerator,
          fc.constantFrom(...SUB_FOLDERS),
          fastqNameGenerator,
        ),
        weight: 3,
      },
      {
        arbitrary: fc.tuple(
          rootFolderGenerator,
          fc.constantFrom(...SUB_FOLDERS),
          fc.constant('nested'),
          fastqNameGenerator,
        ),
        weight: 1,
      },
    ),
    { maxLength: 6, minLength: 1 },
  )
  .map((paths) => uniquePaths(paths.map((segments) => segments.join('/'))));

/** Files directly in one folder, optionally with an `unclassified/` sub-folder. */
const sampleFolderPathSetGenerator = fc
  .tuple(
    rootFolderGenerator,
    fc.uniqueArray(fastqNameGenerator, { maxLength: 4, minLength: 1 }),
    fc.uniqueArray(fastqNameGenerator, { maxLength: 2 }),
  )
  .map(([root, files, unclassified]) => [
    ...files.map((name) => `${root}/${name}`),
    ...unclassified.map((name) => `${root}/${UNCLASSIFIED_FOLDER}/${name}`),
  ]);

/** Barcode (or look-alike) sub-folders of one folder, optionally with `unclassified/`. */
const barcodeFolderPathSetGenerator = fc
  .tuple(
    rootFolderGenerator,
    fc.uniqueArray(fc.tuple(fc.constantFrom(...SUB_FOLDERS), fastqNameGenerator), {
      maxLength: 5,
      minLength: 1,
      selector: ([folder, name]) => `${folder}/${name}`,
    }),
  )
  .map(([root, files]) => files.map(([folder, name]) => `${root}/${folder}/${name}`));

/**
 * Upload path sets with the shapes the pipeline distinguishes (top-level file, files in one
 * folder, barcode sub-folders, `unclassified`) plus the invalid mixes: several roots, mixed
 * depths, non-barcode sub-folders and paths one level too deep. Segments are always safe and
 * names always FASTQ, so the classification rules (not the name rules) decide.
 */
export const relativePathSetGenerator: fc.Arbitrary<string[]> = fc.oneof(
  { arbitrary: fastqNameGenerator.map((name) => [name]), weight: 1 },
  { arbitrary: sampleFolderPathSetGenerator, weight: 2 },
  { arbitrary: barcodeFolderPathSetGenerator, weight: 3 },
  { arbitrary: mixedPathSetGenerator, weight: 3 },
);

/** Client-supplied path strings meant to escape a directory, plus arbitrary text. */
export const unsafePathGenerator = fc.oneof(
  fc.constantFrom(
    '..',
    '../x.fastq',
    '../../etc/passwd.fastq',
    'a/../../b.fastq',
    '/abs/x.fastq',
    './x.fastq',
    'a//b.fastq',
    'a\\..\\b.fastq',
    '.hidden/x.fastq',
    'x$(id).fastq',
    'x;rm.fastq',
    'x|y.fastq',
    'x`y`.fastq',
    "x'y.fastq",
    'x"y.fastq',
    'x y.fastq',
    'a/%2e%2e/b.fastq',
    'C:\\x.fastq',
    '\u0000.fastq',
  ),
  fc.string({ maxLength: 40 }),
  fc
    .array(fc.oneof(pathSegmentGenerator, fc.constantFrom('..', '.', '')), {
      maxLength: 4,
      minLength: 1,
    })
    .map((segments) => segments.join('/')),
);

/** A sheet barcode set and a folder barcode set that are equal, overlapping or disjoint. */
export const sheetFolderBarcodesGenerator = fc.oneof(
  fc
    .uniqueArray(barcodeGenerator, { maxLength: 6, minLength: 1 })
    .map((barcodes) => ({ folders: [...barcodes].reverse(), sheet: barcodes })),
  fc.record({
    folders: fc.uniqueArray(barcodeGenerator, { maxLength: 6, minLength: 1 }),
    sheet: fc.uniqueArray(barcodeGenerator, { maxLength: 6, minLength: 1 }),
  }),
);

/** `barcode,alias` sheet text for a barcode list (aliases are synthetic and unique). */
export function sampleSheetFor(barcodes: readonly string[]): string {
  return ['barcode,alias', ...barcodes.map((barcode, index) => `${barcode},sample_${index}`)].join(
    '\n',
  );
}

/** Options inside the `renamefastqOptionsSchema` domain. */
export const renamefastqOptionsGenerator = fc.record({
  demultiplex: fc.boolean(),
  kitName: fc.constantFrom(...RENAMEFASTQ_KIT_NAMES),
  qScore: fc.integer({ max: RENAMEFASTQ_Q_SCORE_MAX, min: RENAMEFASTQ_Q_SCORE_MIN }),
  qualityFilter: fc.boolean(),
});

export type UploadViolation =
  | { kind: 'TOO_MANY_FILES'; extraFiles: number }
  | { kind: 'TOO_LARGE'; extraBytes: number }
  | { kind: 'UNSAFE_PATH'; path: string; position: number };

/**
 * One way an upload breaks the limits or the path rules (P11). Sizes are relative to the
 * limits the test injects, so no real 1 GiB body is ever built.
 */
export const uploadViolationGenerator: fc.Arbitrary<UploadViolation> = fc.oneof(
  fc.record({
    extraFiles: fc.integer({ max: 3, min: 1 }),
    kind: fc.constant('TOO_MANY_FILES' as const),
  }),
  fc.record({
    extraBytes: fc.integer({ max: 4096, min: 1 }),
    kind: fc.constant('TOO_LARGE' as const),
  }),
  fc.record({
    kind: fc.constant('UNSAFE_PATH' as const),
    path: fc.constantFrom(
      '../x.fastq',
      '../../escape.fastq.gz',
      '/abs/x.fastq',
      '.hidden.fastq',
      'x$(id).fastq',
      'a\\b.fastq',
    ),
    position: fc.integer({ max: 2, min: 0 }),
  }),
);
