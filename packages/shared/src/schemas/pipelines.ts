import { z } from 'zod';

import {
  FASTQ_EXTENSIONS,
  PIPELINE_EXECUTORS,
  PIPELINE_IDS,
  PIPELINE_UNAVAILABLE_REASONS,
  RENAMEFASTQ_DEFAULT_KIT_NAME,
  RENAMEFASTQ_DEFAULT_Q_SCORE,
  RENAMEFASTQ_KIT_NAMES,
  RENAMEFASTQ_Q_SCORE_MAX,
  RENAMEFASTQ_Q_SCORE_MIN,
  RUN_INPUT_FILE_KINDS,
  RUN_INPUT_LAYOUTS,
  RUN_INPUT_MAX_BYTES,
  RUN_INPUT_MAX_FASTQ_FILES,
  RUN_INPUT_RELATIVE_PATH_MAX_LENGTH,
  RUN_NAME_PATTERN,
  SAMPLE_NAME_PATTERN,
  SAMPLE_SHEET_MAX_BYTES,
} from '../constants.js';

const OPTIONS_FIELD_MAX_LENGTH = 4096;
const TEXT_MAX_LENGTH = 1024;

export const pipelineIdSchema = z.enum(PIPELINE_IDS);
export const pipelineExecutorSchema = z.enum(PIPELINE_EXECUTORS);
export const pipelineUnavailableReasonSchema = z.enum(PIPELINE_UNAVAILABLE_REASONS);
export const runInputLayoutSchema = z.enum(RUN_INPUT_LAYOUTS);
export const runInputFileKindSchema = z.enum(RUN_INPUT_FILE_KINDS);
export const renamefastqKitNameSchema = z.enum(RENAMEFASTQ_KIT_NAMES);

export const runNameSchema = z
  .string()
  .trim()
  .regex(RUN_NAME_PATTERN, 'Use 1–64 letters, numbers, spaces, dots, dashes or underscores.');
export const sampleNameSchema = z
  .string()
  .trim()
  .regex(SAMPLE_NAME_PATTERN, 'Use 1–64 letters, numbers, dashes or underscores (no spaces).');

/** User-selectable wf-renamefastq options (allowlist; mapped to Nextflow params by the API). */
export const renamefastqOptionsSchema = z
  .object({
    demultiplex: z.boolean().default(false),
    kitName: renamefastqKitNameSchema.default(RENAMEFASTQ_DEFAULT_KIT_NAME),
    qualityFilter: z.boolean().default(true),
    qScore: z
      .number()
      .int()
      .min(RENAMEFASTQ_Q_SCORE_MIN)
      .max(RENAMEFASTQ_Q_SCORE_MAX)
      .default(RENAMEFASTQ_DEFAULT_Q_SCORE),
  })
  .strict();

const optionsJsonFieldSchema = z
  .string()
  .max(OPTIONS_FIELD_MAX_LENGTH)
  .transform((value, context): unknown => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      context.addIssue({ code: 'custom', message: 'Options must be a JSON object.' });
      return z.NEVER;
    }
  })
  .pipe(renamefastqOptionsSchema);

/**
 * Text fields of `POST /pipelines/{pipelineId}/runs` (multipart values are strings). An empty
 * `sampleName` means "not provided"; `options` is a JSON object string.
 */
export const runLaunchFieldsSchema = z
  .object({
    runName: runNameSchema,
    layout: runInputLayoutSchema,
    sampleName: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value : undefined))
      .pipe(sampleNameSchema.optional()),
    options: optionsJsonFieldSchema.prefault('{}'),
  })
  .strict();

const optionDescriptorBaseSchema = z.object({
  key: z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/),
  label: z.string().min(1).max(128),
  description: z.string().max(TEXT_MAX_LENGTH),
});

export const pipelineOptionDescriptorSchema = z.discriminatedUnion('type', [
  optionDescriptorBaseSchema.extend({ type: z.literal('boolean'), default: z.boolean() }).strict(),
  optionDescriptorBaseSchema
    .extend({
      type: z.literal('enum'),
      default: z.string().max(128),
      values: z.array(z.string().min(1).max(128)).min(1).max(100),
    })
    .strict(),
  optionDescriptorBaseSchema
    .extend({
      type: z.literal('integer'),
      default: z.number().int(),
      min: z.number().int(),
      max: z.number().int(),
    })
    .strict(),
]);

export const pipelineSummarySchema = z
  .object({
    id: pipelineIdSchema,
    name: z.string().min(1).max(128),
    description: z.string().max(TEXT_MAX_LENGTH),
    version: z.string().min(1).max(64),
    executor: pipelineExecutorSchema,
    inputLayouts: z.array(runInputLayoutSchema).max(RUN_INPUT_LAYOUTS.length),
    available: z.boolean(),
    unavailableReason: pipelineUnavailableReasonSchema.nullable(),
  })
  .strict();

export const pipelineLimitsSchema = z
  .object({
    maxFastqFiles: z.literal(RUN_INPUT_MAX_FASTQ_FILES),
    maxTotalBytes: z.literal(RUN_INPUT_MAX_BYTES),
    sampleSheetMaxBytes: z.literal(SAMPLE_SHEET_MAX_BYTES),
    fastqExtensions: z.array(z.enum(FASTQ_EXTENSIONS)),
  })
  .strict();

export const pipelineDetailSchema = pipelineSummarySchema
  .extend({
    options: z.array(pipelineOptionDescriptorSchema).max(20),
    /** Upload limits for Nextflow pipelines; `null` for the built-in Smart Checkup form. */
    limits: pipelineLimitsSchema.nullable(),
  })
  .strict();

export const pipelineListSchema = z
  .object({
    items: z.array(pipelineSummarySchema).max(PIPELINE_IDS.length),
  })
  .strict();

export const jobProgressSchema = z
  .object({
    completedSteps: z.number().int().min(0),
    /** Process name only (e.g. `FASTCAT`), never the task tag, which can carry an alias. */
    currentStep: z
      .string()
      .regex(/^[A-Za-z0-9_]{1,64}$/)
      .nullable(),
    startedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const jobRunInfoSchema = z
  .object({
    layout: runInputLayoutSchema,
    sampleName: z.string().max(64).nullable(),
    options: renamefastqOptionsSchema,
    files: z
      .array(
        z
          .object({
            relativePath: z.string().min(1).max(RUN_INPUT_RELATIVE_PATH_MAX_LENGTH),
            sizeBytes: z.number().int().min(0),
            kind: runInputFileKindSchema,
          })
          .strict(),
      )
      .max(RUN_INPUT_MAX_FASTQ_FILES + 1),
  })
  .strict();

export const jobOutputsSummarySchema = z
  .object({
    fileCount: z.number().int().min(0),
    totalBytes: z.number().int().min(0),
  })
  .strict();
