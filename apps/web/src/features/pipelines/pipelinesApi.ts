import type {
  ApiSuccess,
  JobSubmitResponse,
  PipelineDetail,
  PipelineList,
  PipelineUnavailableReason,
  RenamefastqOptions,
  RunInputLayout,
} from '@portal/shared';

import type { ApiClient, UploadProgressHandler } from '../auth/apiClient';

/** A FASTQ file chosen in the browser plus the relative path it is uploaded under. */
export type LaunchFastqFile = { file: File; relativePath: string };

export type LaunchFields = {
  runName: string;
  layout: RunInputLayout;
  /** Sample name for SINGLE_FILE / SAMPLE_FOLDER; omitted when empty. */
  sampleName?: string;
  options: RenamefastqOptions;
};

/** Fixed upload name: the user's sheet file name is not needed by the API. */
const SAMPLE_SHEET_UPLOAD_NAME = 'sample_sheet.csv';

/** Typed calls for `/api/v1/pipelines*`; every call goes through the shared session/CSRF client. */
export function createPipelinesApi(api: ApiClient) {
  return {
    list: async () => (await api.get<ApiSuccess<PipelineList>>('/pipelines')).data,
    get: async (pipelineId: string) =>
      (await api.get<ApiSuccess<PipelineDetail>>(`/pipelines/${encodeURIComponent(pipelineId)}`))
        .data,
    /** Multipart launch with upload progress; `Idempotency-Key` makes retries safe. */
    launch: async (
      pipelineId: string,
      formData: FormData,
      idempotencyKey: string,
      onProgress?: UploadProgressHandler,
    ) =>
      (
        await api.upload<ApiSuccess<JobSubmitResponse>>(
          `/pipelines/${encodeURIComponent(pipelineId)}/runs`,
          formData,
          { 'Idempotency-Key': idempotencyKey },
          onProgress,
        )
      ).data,
  };
}

export type PipelinesApi = ReturnType<typeof createPipelinesApi>;

/**
 * Builds the launch body in the order the API streams it (design C3/C10): text fields first,
 * then the sample sheet, then FASTQ files named by their relative path.
 */
export function buildLaunchFormData(
  fields: LaunchFields,
  sampleSheet: File | null,
  fastqFiles: readonly LaunchFastqFile[],
): FormData {
  const formData = new FormData();

  formData.append('runName', fields.runName);
  formData.append('layout', fields.layout);

  if (fields.sampleName) {
    formData.append('sampleName', fields.sampleName);
  }

  formData.append('options', JSON.stringify(fields.options));

  if (sampleSheet) {
    formData.append('sampleSheet', sampleSheet, SAMPLE_SHEET_UPLOAD_NAME);
  }

  for (const { file, relativePath } of fastqFiles) {
    formData.append('fastq', file, relativePath);
  }

  return formData;
}

export const LAYOUT_LABELS: Record<RunInputLayout, string> = {
  SINGLE_FILE: 'Single FASTQ file',
  SAMPLE_FOLDER: 'Folder of FASTQ files for one sample',
  BARCODE_FOLDERS: 'Folder with one sub-folder per barcode',
};

/** Safe, user-facing explanations of the readiness reason codes (design C7). */
export const UNAVAILABLE_REASON_MESSAGES: Record<PipelineUnavailableReason, string> = {
  NEXTFLOW_DISABLED: 'Nextflow runs are turned off on this server.',
  NEXTFLOW_MISSING: 'Nextflow is not installed or is not working on this server.',
  DOCKER_UNAVAILABLE: 'Docker is not running on this server.',
  ASSETS_MISSING: 'The pipeline files and containers have not been prepared on this server yet.',
};

export function unavailableMessage(reason: PipelineUnavailableReason | null): string {
  return reason
    ? UNAVAILABLE_REASON_MESSAGES[reason]
    : 'This pipeline is not ready on this server.';
}
