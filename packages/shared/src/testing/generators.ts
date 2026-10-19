import fc from 'fast-check';

import {
  BARCODE_PATTERN,
  FOCUS_AREAS,
  INPUT_MARKERS,
  JOB_STATUSES,
  LIFESTYLE_FACTORS,
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

// ---------- Results & Guidance generators (P14–P18) ----------

export type MarkerRange = (typeof INPUT_MARKERS)[number];

export const focusAreaGenerator = fc.constantFrom(...FOCUS_AREAS);

export const lifestyleFactorsGenerator = fc.subarray([...LIFESTYLE_FACTORS]);

/**
 * A synthetic value of a marker inside its validation range with one decimal (so it is also a
 * valid CSV value), biased towards the range ends and the training midpoint so both bands and
 * the exact threshold are exercised.
 */
export function markerValueGenerator(range: MarkerRange): fc.Arbitrary<number> {
  const tenths = (value: number) => Math.round(value * 10);
  const midpoint = (range.min + range.max) / 2;
  return fc.oneof(
    fc.constantFrom(range.min, range.max, midpoint),
    fc.integer({ max: tenths(midpoint), min: tenths(midpoint) - 1 }).map((value) => value / 10),
    fc.integer({ max: tenths(range.max), min: tenths(range.min) }).map((value) => value / 10),
  );
}

/** Rows of distinct markers (any subset, in any order) with in-range synthetic values. */
export const markerRowsGenerator = fc
  .shuffledSubarray([...INPUT_MARKERS], { maxLength: INPUT_MARKERS.length })
  .chain((ranges) =>
    fc.tuple(...ranges.map((range) => markerValueGenerator(range))).map((values) =>
      ranges.map((range, index) => ({
        marker: range.marker,
        unit: range.unit,
        value: values[index] ?? range.min,
      })),
    ),
  );

/** Input of the mock rule engine (`ageBand` is not used by any rule). */
export const recommendationInputGenerator = fc.record({
  focusArea: focusAreaGenerator,
  lifestyleFactors: lifestyleFactorsGenerator,
  rows: markerRowsGenerator,
});

export const FASTQ_SUFFIXES = ['.fastq.gz', '.fq.gz', '.fastq', '.fq'] as const;

/** One valid row of seqkit stats (`all_fastq_statistics.tsv`) and the sample it describes. */
export type StatsRow = {
  folder: string;
  suffix: (typeof FASTQ_SUFFIXES)[number];
  sample: string;
  numSeqs: number;
  sumLen: number;
  minLen: number;
  avgLen: number;
  maxLen: number;
  avgQual: number;
};

const statsCountGenerator = fc.oneof(
  fc.constantFrom(0, 1, 999_999_999_999_999),
  fc.nat({ max: 10_000_000 }),
);
/** Decimals with up to two fraction digits; `String(value)` never uses an exponent. */
const statsDecimalGenerator = fc.oneof(
  fc.nat({ max: 100_000_000 }).map((value) => value / 100),
  fc.nat({ max: 1000 }),
);

export const statsRowGenerator: fc.Arbitrary<StatsRow> = fc.record({
  avgLen: statsDecimalGenerator,
  avgQual: statsDecimalGenerator,
  folder: fc.constantFrom('', 'all_fastq/', 'out/all_fastq/'),
  maxLen: statsCountGenerator,
  minLen: statsCountGenerator,
  numSeqs: statsCountGenerator,
  sample: sampleNameGenerator,
  suffix: fc.constantFrom(...FASTQ_SUFFIXES),
  sumLen: statsCountGenerator,
});

export const STATS_TSV_HEADER =
  'file\tformat\ttype\tnum_seqs\tsum_len\tmin_len\tavg_len\tmax_len\tAvgQual';

/** seqkit stats TSV text for the given rows (optionally CRLF and without a final newline). */
export function statsTsvFor(
  rows: readonly StatsRow[],
  options: { crlf?: boolean; finalNewline?: boolean } = {},
): string {
  const lines = [
    STATS_TSV_HEADER,
    ...rows.map((row) =>
      [
        `${row.folder}${row.sample}${row.suffix}`,
        'FASTQ',
        'DNA',
        row.numSeqs,
        row.sumLen,
        row.minLen,
        row.avgLen,
        row.maxLen,
        row.avgQual,
      ].join('\t'),
    ),
  ];
  const newline = options.crlf ? '\r\n' : '\n';
  return lines.join(newline) + (options.finalNewline === false ? '' : newline);
}

/** Arbitrary text plus near-valid stats files (valid TSV with one character changed). */
export const statsContentGenerator: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 200, unit: 'binary' }),
  fc.array(fc.string({ maxLength: 20 }), { maxLength: 9 }).map((cells) => cells.join('\t')),
  fc
    .tuple(
      fc.array(statsRowGenerator, { maxLength: 4, minLength: 1 }),
      fc.nat(),
      fc.string({ maxLength: 2, minLength: 1, unit: 'binary' }),
    )
    .map(([rows, position, insert]) => {
      const text = statsTsvFor(rows);
      const at = position % (text.length + 1);
      return `${text.slice(0, at)}${insert}${text.slice(at)}`;
    }),
  fc
    .array(statsRowGenerator, { maxLength: 4 })
    .map((rows) => `${STATS_TSV_HEADER}\n${statsTsvFor(rows).split('\n').slice(1).join('\t')}`),
);

/** Display names meant to break a Content-Disposition header, plus arbitrary text. */
export const displayNameGenerator: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 60, unit: 'binary' }),
  fc.string({ maxLength: 60, unit: 'grapheme' }),
  fc
    .array(
      fc.oneof(
        fc.constantFrom(
          '\r',
          '\n',
          '\r\n',
          '"',
          '\\',
          '/',
          '\u0000',
          '\u007f',
          '\t',
          ';',
          ' ',
          '..',
        ),
        fc.string({ maxLength: 6 }),
      ),
      { maxLength: 8 },
    )
    .map((parts) => parts.join('')),
);

/** Output paths of a job: safe nested paths and paths meant to escape the job directory. */
export const artifactRelativePathGenerator: fc.Arbitrary<string> = fc.oneof(
  fc
    .array(pathSegmentGenerator, { maxLength: 3, minLength: 1 })
    .map((segments) => segments.join('/')),
  unsafePathGenerator,
  fc.constantFrom(
    '../../result.json',
    '../input/input.csv',
    '../../../jobs/other/output/x.tsv',
    '/etc/passwd',
    'fastq/../../run/params.json',
  ),
);
