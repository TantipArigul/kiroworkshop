import type { RunInputLayout } from '@portal/shared';
import { RUN_INPUT_MAX_BYTES, RUN_INPUT_MAX_FASTQ_FILES } from '@portal/shared/constants';
import {
  classifyLayout,
  classifyLayoutAs,
  isFastqFileName,
  matchSheetToFolders,
  parseSampleSheet,
  type SampleSheetIssue,
  type SampleSheetRow,
} from '@portal/shared/run-input';

/** A browser selection reduced to what the rules need: never the file content. */
export type SelectedFile = { relativePath: string; size: number };

export type InputPreview = {
  /** Layout the files look like, independent of the chosen input type. */
  detectedLayout: RunInputLayout | null;
  /** FASTQ paths that will be uploaded (the pipeline reads them). */
  uploadPaths: string[];
  fileCount: number;
  totalBytes: number;
  barcodes: string[];
  /** Non-FASTQ files in a selected folder (for example hidden system files); not uploaded. */
  skippedCount: number;
  /** FASTQ files under `unclassified/`, which the pipeline ignores; not uploaded. */
  ignoredCount: number;
  issues: string[];
};

export type SheetPreview = {
  rows: SampleSheetRow[];
  issues: SampleSheetIssue[];
  /** `null` until the sheet parses and the folders have barcodes to compare with. */
  match: ReturnType<typeof matchSheetToFolders> | null;
};

const EMPTY_PREVIEW: InputPreview = {
  barcodes: [],
  detectedLayout: null,
  fileCount: 0,
  ignoredCount: 0,
  issues: [],
  skippedCount: 0,
  totalBytes: 0,
  uploadPaths: [],
};

/** `webkitRelativePath` for folder selections (`folder/…/file`), the file name otherwise. */
export function relativePathOf(file: File): string {
  return file.webkitRelativePath || file.name;
}

function lastSegment(path: string): string {
  return path.split('/').at(-1) ?? '';
}

/**
 * Summarises a selection with the shared layout rules (design C4), so the browser reports the
 * same problems the API would before anything is uploaded (US-017 AC5, US-018 AC2–AC3).
 */
export function buildInputPreview(
  layout: RunInputLayout,
  files: readonly SelectedFile[],
): InputPreview {
  if (files.length === 0) {
    return EMPTY_PREVIEW;
  }

  // Folder pickers return every file in the folder; only FASTQ files are candidates. A single
  // file is checked as chosen so a wrong extension is reported instead of silently dropped.
  const candidates =
    layout === 'SINGLE_FILE'
      ? [...files]
      : files.filter((file) => isFastqFileName(lastSegment(file.relativePath)));
  const paths = candidates.map((file) => file.relativePath);
  const detected = classifyLayout(paths);
  const chosen = classifyLayoutAs(layout, paths);
  const preview: InputPreview = {
    ...EMPTY_PREVIEW,
    detectedLayout: detected.ok ? detected.layout : null,
    skippedCount: files.length - candidates.length,
  };

  if (!chosen.ok) {
    return { ...preview, issues: [chosen.message] };
  }

  const used = new Set(chosen.usedPaths);
  const uploaded = candidates.filter((file) => used.has(file.relativePath));
  const totalBytes = uploaded.reduce((sum, file) => sum + file.size, 0);
  const issues: string[] = [];

  if (uploaded.length > RUN_INPUT_MAX_FASTQ_FILES) {
    issues.push(
      `Select at most ${RUN_INPUT_MAX_FASTQ_FILES} FASTQ files (${uploaded.length} selected).`,
    );
  }

  if (totalBytes > RUN_INPUT_MAX_BYTES) {
    issues.push('The FASTQ files must be 1 GB or smaller in total.');
  }

  return {
    ...preview,
    barcodes: chosen.barcodes,
    fileCount: uploaded.length,
    ignoredCount: chosen.ignoredPaths.length,
    issues,
    totalBytes,
    uploadPaths: chosen.usedPaths,
  };
}

/** Parses a sample sheet and compares its barcodes with the uploaded barcode folders (P9). */
export function buildSheetPreview(
  content: string,
  folderBarcodes: readonly string[],
): SheetPreview {
  const parsed = parseSampleSheet(content);

  if (!parsed.ok) {
    return { issues: parsed.issues, match: null, rows: [] };
  }

  return {
    issues: [],
    match:
      folderBarcodes.length > 0
        ? matchSheetToFolders(
            parsed.rows.map((row) => row.barcode),
            folderBarcodes,
          )
        : null,
    rows: parsed.rows,
  };
}
