import {
  INPUT_FILE_HEADER,
  INPUT_FILE_MAX_BYTES,
  INPUT_FILE_MAX_ROWS,
  INPUT_MARKERS,
  type InputMarkerName,
} from '@portal/shared';

export type InputRow = { marker: InputMarkerName; value: number; unit: string };

export type InputIssueCode =
  | 'UNSAFE_FILENAME'
  | 'UNSUPPORTED_TYPE'
  | 'FILE_EMPTY'
  | 'FILE_TOO_LARGE'
  | 'INVALID_ENCODING'
  | 'INVALID_HEADER'
  | 'ROW_COUNT'
  | 'INVALID_ROW'
  | 'FORMULA_PREFIX'
  | 'UNKNOWN_MARKER'
  | 'DUPLICATE_MARKER'
  | 'INVALID_VALUE'
  | 'OUT_OF_RANGE'
  | 'UNIT_MISMATCH';

export type InputIssue = { code: InputIssueCode; message: string; line?: number };

export type ValidatedInputFile = {
  rows: InputRow[];
  sanitizedName: string;
  sizeBytes: number;
};

export type InputValidationResult =
  | ({ ok: true } & ValidatedInputFile)
  | { ok: false; issues: InputIssue[]; unsafeFilename: boolean };

const MARKERS = new Map<string, (typeof INPUT_MARKERS)[number]>(
  INPUT_MARKERS.map((item) => [item.marker, item]),
);
const MAX_ISSUES = 10;
// Anything that is not a printable character, apart from the line breaks CSV needs.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const UNSAFE_NAME = /[/\\\u0000-\u001f\u007f]|\.\./;
const FORMULA_PREFIXES = ['=', '+', '-', '@'];
const NUMBER_PATTERN = /^\d{1,6}(\.\d{1,4})?$/;

/**
 * Server-side validation of the inline CSV (design C2). Client-declared metadata is never
 * trusted; messages describe the rule that failed and never echo file content.
 */
export function validateInputFile(name: string, content: string): InputValidationResult {
  if (UNSAFE_NAME.test(name) || name.startsWith('.')) {
    return {
      ok: false,
      issues: [{ code: 'UNSAFE_FILENAME', message: 'The file name is not allowed.' }],
      unsafeFilename: true,
    };
  }

  if (!name.toLowerCase().endsWith('.csv')) {
    return fail({ code: 'UNSUPPORTED_TYPE', message: 'Upload a .csv file.' });
  }

  const sizeBytes = Buffer.byteLength(content, 'utf8');

  if (sizeBytes === 0) {
    return fail({ code: 'FILE_EMPTY', message: 'The file is empty.' });
  }

  if (sizeBytes > INPUT_FILE_MAX_BYTES) {
    return fail({
      code: 'FILE_TOO_LARGE',
      message: `The file must be at most ${INPUT_FILE_MAX_BYTES / 1024} KB.`,
    });
  }

  if (content.includes('\uFFFD') || CONTROL_CHARACTERS.test(content)) {
    return fail({
      code: 'INVALID_ENCODING',
      message: 'The file must be plain UTF-8 text without control characters.',
    });
  }

  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim());

  while (lines.length > 0 && lines.at(-1) === '') {
    lines.pop();
  }

  if (lines[0] !== INPUT_FILE_HEADER) {
    return fail({
      code: 'INVALID_HEADER',
      message: `The first line must be "${INPUT_FILE_HEADER}".`,
      line: 1,
    });
  }

  const dataLines = lines.slice(1);

  if (dataLines.length === 0 || dataLines.length > INPUT_FILE_MAX_ROWS) {
    return fail({
      code: 'ROW_COUNT',
      message: `Include between 1 and ${INPUT_FILE_MAX_ROWS} marker rows.`,
    });
  }

  const issues: InputIssue[] = [];
  const rows: InputRow[] = [];
  const seen = new Set<string>();

  dataLines.forEach((line, index) => {
    const issue = validateRow(line, index + 2, seen, rows);

    if (issue && issues.length < MAX_ISSUES) {
      issues.push(issue);
    }
  });

  if (issues.length > 0) {
    return { ok: false, issues, unsafeFilename: false };
  }

  return { ok: true, rows, sanitizedName: name.trim(), sizeBytes };
}

function validateRow(
  line: string,
  lineNumber: number,
  seen: Set<string>,
  rows: InputRow[],
): InputIssue | null {
  const cells = line.split(',').map((cell) => cell.trim());

  if (cells.length !== 3 || line.includes('"')) {
    return {
      code: 'INVALID_ROW',
      message: 'Each row needs exactly marker, value and unit.',
      line: lineNumber,
    };
  }

  if (cells.some((cell) => FORMULA_PREFIXES.some((prefix) => cell.startsWith(prefix)))) {
    return {
      code: 'FORMULA_PREFIX',
      message: 'Cells must not start with =, +, - or @.',
      line: lineNumber,
    };
  }

  const [markerName = '', rawValue = '', unit = ''] = cells;
  const marker = MARKERS.get(markerName);

  if (!marker) {
    return { code: 'UNKNOWN_MARKER', message: 'The marker is not supported.', line: lineNumber };
  }

  if (seen.has(markerName)) {
    return { code: 'DUPLICATE_MARKER', message: 'Each marker may appear once.', line: lineNumber };
  }

  seen.add(markerName);

  if (!NUMBER_PATTERN.test(rawValue)) {
    return { code: 'INVALID_VALUE', message: 'The value must be a number.', line: lineNumber };
  }

  const value = Number(rawValue);

  if (value < marker.min || value > marker.max) {
    return {
      code: 'OUT_OF_RANGE',
      message: `The value must be between ${marker.min} and ${marker.max}.`,
      line: lineNumber,
    };
  }

  if (unit !== marker.unit) {
    return {
      code: 'UNIT_MISMATCH',
      message: `The unit for ${marker.marker} must be ${marker.unit}.`,
      line: lineNumber,
    };
  }

  rows.push({ marker: marker.marker, unit, value });
  return null;
}

function fail(issue: InputIssue): InputValidationResult {
  return { ok: false, issues: [issue], unsafeFilename: false };
}
