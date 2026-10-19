// Pure, dependency-free run-input rules shared by the browser (early feedback) and the API
// (authoritative check) — design C4. Never echo file names, paths, aliases or file content in
// messages: they can carry sample identifiers.

import {
  BARCODE_PATTERN,
  FASTQ_EXTENSIONS,
  PATH_SEGMENT_PATTERN,
  RUN_INPUT_LAYOUT_DEPTH,
  RUN_INPUT_RELATIVE_PATH_MAX_LENGTH,
  RUN_NAME_PATTERN,
  SAMPLE_NAME_PATTERN,
  SAMPLE_SHEET_HEADER,
  SAMPLE_SHEET_MAX_BYTES,
  SAMPLE_SHEET_MAX_ROWS,
  UNCLASSIFIED_FOLDER,
  type RUN_INPUT_LAYOUTS,
} from '../constants.js';

type Layout = (typeof RUN_INPUT_LAYOUTS)[number];

const MAX_REPORTED_ISSUES = 20;
const MAX_LAYOUT_DEPTH = RUN_INPUT_LAYOUT_DEPTH.BARCODE_FOLDERS;
const SHEET_QUOTES = new Set(['"', "'", '`']);
const FORMULA_PREFIXES = ['=', '+', '-', '@'];

/** Quotes and control characters (including tab) are never valid in a sample sheet line. */
function hasUnsafeSheetCharacter(value: string): boolean {
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;

    if (SHEET_QUOTES.has(char) || codePoint < 0x20 || codePoint === 0x7f) {
      return true;
    }
  }

  return false;
}

// ---------- Names and path segments ----------

/** A single path segment: allowlisted characters, no leading dot and no `..` anywhere. */
export function isSafePathSegment(segment: string): boolean {
  return PATH_SEGMENT_PATTERN.test(segment) && !segment.includes('..');
}

export function isFastqFileName(name: string): boolean {
  return FASTQ_EXTENSIONS.some(
    (extension) => name.length > extension.length && name.endsWith(extension),
  );
}

/** Splits a client-supplied relative path on `/`; `null` when any segment is unsafe. */
export function splitRelativePath(path: string): string[] | null {
  if (path.length === 0 || path.length > RUN_INPUT_RELATIVE_PATH_MAX_LENGTH) {
    return null;
  }

  const segments = path.split('/');
  return segments.every(isSafePathSegment) ? segments : null;
}

/** Returns the trimmed run name when valid, otherwise `null`. */
export function normalizeRunName(value: string): string | null {
  const trimmed = value.trim();
  return RUN_NAME_PATTERN.test(trimmed) ? trimmed : null;
}

/** Sample names and sheet aliases: no whitespace, quotes or shell metacharacters. */
export function isValidSampleName(value: string): boolean {
  return SAMPLE_NAME_PATTERN.test(value);
}

export function isBarcodeName(value: string): boolean {
  return BARCODE_PATTERN.test(value);
}

// ---------- Layout classification (mirrors the pipeline's `determineInputType`) ----------

export type LayoutIssueCode =
  | 'NO_FILES'
  | 'UNSAFE_PATH'
  | 'NOT_FASTQ'
  | 'DUPLICATE_PATH'
  | 'TOO_DEEP'
  | 'MULTIPLE_TOP_LEVEL_FILES'
  | 'MULTIPLE_ROOT_FOLDERS'
  | 'MIXED_LAYOUT'
  | 'NO_BARCODE_FOLDERS'
  | 'INVALID_BARCODE_FOLDER'
  | 'LAYOUT_MISMATCH';

export type LayoutClassification =
  | {
      ok: true;
      layout: Layout;
      /** Selected folder name (first segment) for folder layouts, otherwise `null`. */
      rootFolder: string | null;
      /** Sorted barcode folder names (BARCODE_FOLDERS only; `unclassified` excluded). */
      barcodes: string[];
      /** Paths the pipeline will read. */
      usedPaths: string[];
      /** FASTQ files under `unclassified/`, which the pipeline ignores. */
      ignoredPaths: string[];
    }
  | { ok: false; code: LayoutIssueCode; message: string };

const LAYOUT_MESSAGES: Record<LayoutIssueCode, string> = {
  NO_FILES: 'Select at least one FASTQ file.',
  UNSAFE_PATH:
    'File and folder names may only use letters, numbers, dots, dashes and underscores, and must not start with a dot.',
  NOT_FASTQ: 'Only .fastq, .fq, .fastq.gz and .fq.gz files are accepted.',
  DUPLICATE_PATH: 'The same file was selected more than once.',
  TOO_DEEP: 'Folders may contain at most one level of sub-folders.',
  MULTIPLE_TOP_LEVEL_FILES: 'Select one FASTQ file, or a folder that contains the files.',
  MULTIPLE_ROOT_FOLDERS: 'Select a single folder.',
  MIXED_LAYOUT: 'A folder cannot contain FASTQ files and also sub-folders with FASTQ files.',
  NO_BARCODE_FOLDERS: 'The folder has no barcode sub-folders with FASTQ files.',
  INVALID_BARCODE_FOLDER: 'Sub-folder names must look like barcode01, barcode02, …',
  LAYOUT_MISMATCH: 'The selected files do not match the chosen input type.',
};

function layoutIssue(code: LayoutIssueCode): LayoutClassification {
  return { code, message: LAYOUT_MESSAGES[code], ok: false };
}

/**
 * Classifies uploaded FASTQ relative paths: one top-level file (SINGLE_FILE), files directly in
 * one folder (SAMPLE_FOLDER), or files in barcode sub-folders of one folder (BARCODE_FOLDERS).
 * `unclassified/` is ignored like the pipeline does; anything else mixed or deeper is rejected.
 */
export function classifyLayout(paths: readonly string[]): LayoutClassification {
  if (paths.length === 0) {
    return layoutIssue('NO_FILES');
  }

  const seen = new Set<string>();
  const split: string[][] = [];

  for (const path of paths) {
    const segments = splitRelativePath(path);

    if (!segments) {
      return layoutIssue('UNSAFE_PATH');
    }

    if (!isFastqFileName(segments.at(-1) ?? '')) {
      return layoutIssue('NOT_FASTQ');
    }

    if (seen.has(path)) {
      return layoutIssue('DUPLICATE_PATH');
    }

    if (segments.length > MAX_LAYOUT_DEPTH) {
      return layoutIssue('TOO_DEEP');
    }

    seen.add(path);
    split.push(segments);
  }

  const topLevel = split.filter((segments) => segments.length === 1);
  const inFolder = split.filter((segments) => segments.length === 2);
  const inSubFolder = split.filter((segments) => segments.length === 3);

  if (topLevel.length > 0) {
    if (inFolder.length > 0 || inSubFolder.length > 0) {
      return layoutIssue('MIXED_LAYOUT');
    }

    if (topLevel.length > 1) {
      return layoutIssue('MULTIPLE_TOP_LEVEL_FILES');
    }

    return {
      barcodes: [],
      ignoredPaths: [],
      layout: 'SINGLE_FILE',
      ok: true,
      rootFolder: null,
      usedPaths: [...paths],
    };
  }

  const roots = new Set(split.map((segments) => segments[0]));

  if (roots.size > 1) {
    return layoutIssue('MULTIPLE_ROOT_FOLDERS');
  }

  const rootFolder = split[0]?.[0] ?? null;
  const unclassified = inSubFolder.filter((segments) => segments[1] === UNCLASSIFIED_FOLDER);
  const barcoded = inSubFolder.filter((segments) => segments[1] !== UNCLASSIFIED_FOLDER);
  const join = (segments: string[]) => segments.join('/');

  if (inFolder.length > 0) {
    if (barcoded.length > 0) {
      return layoutIssue('MIXED_LAYOUT');
    }

    return {
      barcodes: [],
      ignoredPaths: unclassified.map(join),
      layout: 'SAMPLE_FOLDER',
      ok: true,
      rootFolder,
      usedPaths: inFolder.map(join),
    };
  }

  if (barcoded.length === 0) {
    return layoutIssue('NO_BARCODE_FOLDERS');
  }

  const barcodes = [...new Set(barcoded.map((segments) => segments[1] ?? ''))].sort();

  if (!barcodes.every(isBarcodeName)) {
    return layoutIssue('INVALID_BARCODE_FOLDER');
  }

  return {
    barcodes,
    ignoredPaths: unclassified.map(join),
    layout: 'BARCODE_FOLDERS',
    ok: true,
    rootFolder,
    usedPaths: barcoded.map(join),
  };
}

/** Classifies and checks the result against the layout the user chose (P8). */
export function classifyLayoutAs(expected: Layout, paths: readonly string[]): LayoutClassification {
  const result = classifyLayout(paths);

  if (result.ok && result.layout !== expected) {
    return layoutIssue('LAYOUT_MISMATCH');
  }

  return result;
}

// ---------- Sample sheet ----------

export type SampleSheetRow = { line: number; barcode: string; alias: string };

export type SampleSheetIssueCode =
  | 'TOO_LARGE'
  | 'EMPTY'
  | 'INVALID_HEADER'
  | 'NO_ROWS'
  | 'TOO_MANY_ROWS'
  | 'EMPTY_ROW'
  | 'UNSAFE_CHARACTER'
  | 'TOO_FEW_COLUMNS'
  | 'INVALID_BARCODE'
  | 'DUPLICATE_BARCODE'
  | 'INVALID_ALIAS'
  | 'DUPLICATE_ALIAS';

export type SampleSheetIssue = { code: SampleSheetIssueCode; line?: number; message: string };

export type SampleSheetResult =
  { ok: true; rows: SampleSheetRow[] } | { ok: false; issues: SampleSheetIssue[] };

const SHEET_MESSAGES: Record<SampleSheetIssueCode, string> = {
  TOO_LARGE: 'The sample sheet must be 64 KB or smaller.',
  EMPTY: 'The sample sheet is empty.',
  INVALID_HEADER: 'The first line must be the header barcode,alias.',
  NO_ROWS: 'The sample sheet has no samples.',
  TOO_MANY_ROWS: `The sample sheet may list at most ${SAMPLE_SHEET_MAX_ROWS} samples.`,
  EMPTY_ROW: 'Remove the empty line.',
  UNSAFE_CHARACTER:
    'Quotes, control characters and values starting with =, +, - or @ are not allowed.',
  TOO_FEW_COLUMNS: 'Each line needs a barcode and an alias.',
  INVALID_BARCODE: 'The barcode must look like barcode01.',
  DUPLICATE_BARCODE: 'The barcode is listed more than once.',
  INVALID_ALIAS:
    'The alias may only use letters, numbers, dashes and underscores (no spaces, at most 64).',
  DUPLICATE_ALIAS: 'The alias is listed more than once.',
};

function sheetIssue(code: SampleSheetIssueCode, line?: number): SampleSheetIssue {
  return line === undefined
    ? { code, message: SHEET_MESSAGES[code] }
    : { code, line, message: SHEET_MESSAGES[code] };
}

/** UTF-8 byte length without platform APIs (works in the browser and Node). */
export function utf8ByteLength(value: string): number {
  let bytes = 0;

  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }

  return bytes;
}

/**
 * Parses a `barcode,alias` sample sheet (UTF-8, optional BOM, extra columns allowed) with the
 * pipeline's rules plus the portal's stricter alias, uniqueness and spreadsheet-safety rules.
 */
export function parseSampleSheet(content: string): SampleSheetResult {
  if (utf8ByteLength(content) > SAMPLE_SHEET_MAX_BYTES) {
    return { issues: [sheetIssue('TOO_LARGE')], ok: false };
  }

  const text = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const lines = text.split(/\r\n|\n|\r/);

  while (lines.length > 0 && (lines.at(-1) ?? '').trim() === '') {
    lines.pop();
  }

  const [headerLine, ...dataLines] = lines;

  if (headerLine === undefined) {
    return { issues: [sheetIssue('EMPTY')], ok: false };
  }

  const header = headerLine.split(',').map((cell) => cell.trim());

  if (
    hasUnsafeSheetCharacter(headerLine) ||
    header[0] !== SAMPLE_SHEET_HEADER[0] ||
    header[1] !== SAMPLE_SHEET_HEADER[1]
  ) {
    return { issues: [sheetIssue('INVALID_HEADER', 1)], ok: false };
  }

  if (dataLines.length === 0) {
    return { issues: [sheetIssue('NO_ROWS')], ok: false };
  }

  if (dataLines.length > SAMPLE_SHEET_MAX_ROWS) {
    return { issues: [sheetIssue('TOO_MANY_ROWS')], ok: false };
  }

  const issues: SampleSheetIssue[] = [];
  const rows: SampleSheetRow[] = [];
  const barcodes = new Set<string>();
  const aliases = new Set<string>();

  dataLines.forEach((raw, index) => {
    const line = index + 2;

    if (raw.trim() === '') {
      issues.push(sheetIssue('EMPTY_ROW', line));
      return;
    }

    const cells = raw.split(',').map((cell) => cell.trim());

    if (
      hasUnsafeSheetCharacter(raw) ||
      cells.some((cell) => FORMULA_PREFIXES.some((prefix) => cell.startsWith(prefix)))
    ) {
      issues.push(sheetIssue('UNSAFE_CHARACTER', line));
      return;
    }

    const [barcode = '', alias = ''] = cells;

    if (cells.length < SAMPLE_SHEET_HEADER.length || barcode === '' || alias === '') {
      issues.push(sheetIssue('TOO_FEW_COLUMNS', line));
      return;
    }

    let valid = true;

    if (!isBarcodeName(barcode)) {
      issues.push(sheetIssue('INVALID_BARCODE', line));
      valid = false;
    } else if (barcodes.has(barcode)) {
      issues.push(sheetIssue('DUPLICATE_BARCODE', line));
      valid = false;
    }

    if (!isValidSampleName(alias)) {
      issues.push(sheetIssue('INVALID_ALIAS', line));
      valid = false;
    } else if (aliases.has(alias)) {
      issues.push(sheetIssue('DUPLICATE_ALIAS', line));
      valid = false;
    }

    barcodes.add(barcode);
    aliases.add(alias);

    if (valid) {
      rows.push({ alias, barcode, line });
    }
  });

  return issues.length > 0
    ? { issues: issues.slice(0, MAX_REPORTED_ISSUES), ok: false }
    : { ok: true, rows };
}

/**
 * The pipeline silently drops barcodes that are not in the sheet; the portal requires the set
 * of sheet barcodes to equal the set of barcode folders (P9). `unclassified` is never counted.
 */
export function matchSheetToFolders(
  sheetBarcodes: readonly string[],
  folderBarcodes: readonly string[],
): { ok: boolean; missingFolders: string[]; unlistedFolders: string[] } {
  const sheet = new Set(sheetBarcodes);
  const folders = new Set(folderBarcodes.filter((name) => name !== UNCLASSIFIED_FOLDER));
  const missingFolders = [...sheet].filter((barcode) => !folders.has(barcode)).sort();
  const unlistedFolders = [...folders].filter((barcode) => !sheet.has(barcode)).sort();

  return {
    missingFolders,
    ok: missingFolders.length === 0 && unlistedFolders.length === 0,
    unlistedFolders,
  };
}

// ---------- Field combinations ----------

export type LaunchRuleIssue = {
  field: 'sampleName' | 'sampleSheet' | 'options.demultiplex';
  code: 'NOT_ALLOWED' | 'REQUIRED';
  message: string;
};

/**
 * Cross-field rules of a launch: barcode folders need a sample sheet and no sample name and
 * cannot be demultiplexed again (US-017 AC4); the other layouts take no sample sheet.
 */
export function checkLaunchRules(input: {
  layout: Layout;
  sampleName?: string | null | undefined;
  demultiplex: boolean;
  hasSampleSheet: boolean;
}): LaunchRuleIssue[] {
  const issues: LaunchRuleIssue[] = [];

  if (input.layout === 'BARCODE_FOLDERS') {
    if (input.sampleName) {
      issues.push({
        code: 'NOT_ALLOWED',
        field: 'sampleName',
        message: 'Barcode folders take their sample names from the sample sheet.',
      });
    }

    if (!input.hasSampleSheet) {
      issues.push({
        code: 'REQUIRED',
        field: 'sampleSheet',
        message: 'Add a sample sheet for barcode folders.',
      });
    }

    if (input.demultiplex) {
      issues.push({
        code: 'NOT_ALLOWED',
        field: 'options.demultiplex',
        message: 'Barcode folders are already demultiplexed.',
      });
    }
  } else if (input.hasSampleSheet) {
    issues.push({
      code: 'NOT_ALLOWED',
      field: 'sampleSheet',
      message: 'A sample sheet is only used with barcode folders.',
    });
  }

  return issues;
}
