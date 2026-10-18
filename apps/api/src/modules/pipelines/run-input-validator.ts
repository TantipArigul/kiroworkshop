import {
  checkLaunchRules,
  classifyLayoutAs,
  matchSheetToFolders,
  parseSampleSheet,
  runLaunchFieldsSchema,
  type RenamefastqOptions,
  type RunInputLayout,
} from '@portal/shared';

/** Where uploaded files live, relative to `jobs/{id}/input` (and to the staging directory). */
export const FASTQ_DIRECTORY = 'fastq';
export const SAMPLE_SHEET_FILE_NAME = 'sample_sheet.csv';

export type RunInputFile = {
  /** Relative to the input directory: `fastq/<uploaded path>` or `sample_sheet.csv`. */
  relativePath: string;
  sizeBytes: number;
  kind: 'FASTQ' | 'SAMPLE_SHEET';
};

/** Result of the multipart receiver (C3) handed to the validator. */
export type ReceivedRunUpload = {
  fields: Record<string, string>;
  /** Paths as uploaded (relative, `/`-separated, already segment-checked). */
  fastqFiles: { relativePath: string; sizeBytes: number }[];
  sampleSheet: { content: string; sizeBytes: number } | null;
};

export type ValidatedRunInput = {
  runName: string;
  layout: RunInputLayout;
  sampleName: string | null;
  options: RenamefastqOptions;
  /** FASTQ file (SINGLE_FILE) or folder the pipeline reads, relative to the input directory. */
  fastqRoot: string;
  barcodes: string[];
  files: RunInputFile[];
  fileCount: number;
  totalBytes: number;
};

export type RunInputIssue = {
  field: string;
  code: string;
  message: string;
  line?: number;
};

export type RunInputValidation =
  { ok: true; input: ValidatedRunInput } | { ok: false; issues: RunInputIssue[] };

const MAX_ISSUES = 20;

/**
 * Authoritative launch validation (design C4): the shared layout, sheet and name rules plus the
 * options schema and cross-field rules. Messages never echo file content, paths or aliases.
 */
export function validateLaunch(upload: ReceivedRunUpload): RunInputValidation {
  const issues: RunInputIssue[] = [];
  const parsed = runLaunchFieldsSchema.safeParse(upload.fields);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.') || 'fields';
      issues.push({
        code: issue.code === 'unrecognized_keys' ? 'UNEXPECTED_FIELD' : 'INVALID_VALUE',
        field,
        message:
          issue.code === 'unrecognized_keys'
            ? 'Unexpected field.'
            : issue.code === 'custom' || issue.code === 'invalid_format'
              ? issue.message
              : 'Invalid value.',
      });
    }

    return { issues: issues.slice(0, MAX_ISSUES), ok: false };
  }

  const fields = parsed.data;
  const sampleName = fields.sampleName ?? null;
  const classification = classifyLayoutAs(
    fields.layout,
    upload.fastqFiles.map((file) => file.relativePath),
  );

  if (!classification.ok) {
    issues.push({ code: classification.code, field: 'files', message: classification.message });
  }

  for (const rule of checkLaunchRules({
    demultiplex: fields.options.demultiplex,
    hasSampleSheet: upload.sampleSheet !== null,
    layout: fields.layout,
    sampleName,
  })) {
    issues.push({ code: rule.code, field: rule.field, message: rule.message });
  }

  if (upload.sampleSheet && fields.layout === 'BARCODE_FOLDERS') {
    const sheet = parseSampleSheet(upload.sampleSheet.content);

    if (!sheet.ok) {
      for (const issue of sheet.issues) {
        issues.push({
          code: issue.code,
          field: issue.line ? `sampleSheet.line ${issue.line}` : 'sampleSheet',
          message: issue.message,
          ...(issue.line ? { line: issue.line } : {}),
        });
      }
    } else if (classification.ok) {
      const match = matchSheetToFolders(
        sheet.rows.map((row) => row.barcode),
        classification.barcodes,
      );

      if (!match.ok) {
        issues.push({
          code: 'SHEET_MISMATCH',
          field: 'sampleSheet',
          message: 'The barcodes in the sample sheet must match the barcode folders exactly.',
        });
      }
    }
  }

  if (issues.length > 0 || !classification.ok) {
    return { issues: issues.slice(0, MAX_ISSUES), ok: false };
  }

  const fastqRoot =
    classification.layout === 'SINGLE_FILE'
      ? `${FASTQ_DIRECTORY}/${classification.usedPaths[0] ?? ''}`
      : `${FASTQ_DIRECTORY}/${classification.rootFolder ?? ''}`;
  const files: RunInputFile[] = [
    ...upload.fastqFiles.map((file) => ({
      kind: 'FASTQ' as const,
      relativePath: `${FASTQ_DIRECTORY}/${file.relativePath}`,
      sizeBytes: file.sizeBytes,
    })),
    ...(upload.sampleSheet
      ? [
          {
            kind: 'SAMPLE_SHEET' as const,
            relativePath: SAMPLE_SHEET_FILE_NAME,
            sizeBytes: upload.sampleSheet.sizeBytes,
          },
        ]
      : []),
  ];

  return {
    input: {
      barcodes: classification.barcodes,
      fastqRoot,
      fileCount: upload.fastqFiles.length,
      files,
      layout: fields.layout,
      options: fields.options,
      runName: fields.runName,
      sampleName,
      totalBytes: upload.fastqFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
    },
    ok: true,
  };
}
