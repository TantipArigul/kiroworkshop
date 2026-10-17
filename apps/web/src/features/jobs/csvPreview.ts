import {
  INPUT_FILE_HEADER,
  INPUT_FILE_MAX_BYTES,
  INPUT_FILE_MAX_ROWS,
  INPUT_MARKERS,
} from '@portal/shared/constants';

export type CsvPreview = {
  sizeBytes: number;
  rowCount: number;
  markers: string[];
  /** Client-side hints only; the server re-validates every rule. */
  issues: string[];
};

const KNOWN_MARKERS = new Set<string>(INPUT_MARKERS.map((item) => item.marker));

export function previewCsv(content: string): CsvPreview {
  const sizeBytes = new TextEncoder().encode(content).length;
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const [header, ...rows] = lines;
  const markers = rows.map((row) => row.split(',')[0]?.trim() ?? '');
  const issues: string[] = [];

  if (sizeBytes > INPUT_FILE_MAX_BYTES) {
    issues.push(`The file is larger than ${INPUT_FILE_MAX_BYTES / 1024} KB.`);
  }

  if (header?.trim() !== INPUT_FILE_HEADER) {
    issues.push(`The first line must be "${INPUT_FILE_HEADER}".`);
  }

  if (rows.length === 0 || rows.length > INPUT_FILE_MAX_ROWS) {
    issues.push(`Include between 1 and ${INPUT_FILE_MAX_ROWS} marker rows.`);
  }

  const unknown = markers.filter((marker) => !KNOWN_MARKERS.has(marker));

  if (unknown.length > 0) {
    issues.push(`${unknown.length} row(s) use a marker that is not in the supported list.`);
  }

  return { sizeBytes, rowCount: rows.length, markers, issues };
}
