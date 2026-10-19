import type {
  ApiSuccess,
  JobCancelResponse,
  JobDetail,
  JobList,
  JobSubmitRequest,
  JobSubmitResponse,
  SampleInput,
} from '@portal/shared';

import type { ApiClient } from '../auth/apiClient';

export const JOB_PAGE_SIZE = 20;

/** Typed calls for `/api/v1/jobs*`; every call goes through the shared session/CSRF client. */
export function createJobsApi(api: ApiClient) {
  return {
    sampleInput: async () => (await api.get<ApiSuccess<SampleInput>>('/jobs/sample-input')).data,
    submit: async (body: JobSubmitRequest, idempotencyKey: string) =>
      (
        await api.post<ApiSuccess<JobSubmitResponse>>('/jobs', body, {
          'Idempotency-Key': idempotencyKey,
        })
      ).data,
    list: async (page: number) =>
      (await api.get<ApiSuccess<JobList>>(`/jobs?page=${page}&limit=${JOB_PAGE_SIZE}`)).data,
    get: async (jobId: string) =>
      (await api.get<ApiSuccess<JobDetail>>(`/jobs/${encodeURIComponent(jobId)}`)).data,
    remove: async (jobId: string) => {
      await api.delete(`/jobs/${encodeURIComponent(jobId)}`);
    },
    /** `POST /jobs/{jobId}/cancel` — QUEUED/RUNNING only; a finished job answers `409 CONFLICT`. */
    cancel: async (jobId: string) =>
      (await api.post<ApiSuccess<JobCancelResponse>>(`/jobs/${encodeURIComponent(jobId)}/cancel`))
        .data,
  };
}

export type JobsApi = ReturnType<typeof createJobsApi>;

export function humanize(value: string): string {
  const words = value.toLowerCase().split('_');

  return words
    .map((word, index) => (index === 0 ? word[0]?.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(
    new Date(value),
  );
}

const BYTE_UNITS = ['KB', 'MB', 'GB'] as const;
const BYTES_PER_UNIT = 1024;

/** Binary units (1 KB = 1024 B), matching the 1 GiB / 64 KB limits shown to users. */
export function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_UNIT) {
    return `${bytes} B`;
  }

  let value = bytes / BYTES_PER_UNIT;
  let unit = 0;

  while (value >= BYTES_PER_UNIT && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit += 1;
  }

  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

const SHORT_JOB_ID_LENGTH = 8;

/** Short Job ID for tables: the random tail of the cuid (its head is a shared timestamp). */
export function shortJobId(jobId: string): string {
  return jobId.slice(-SHORT_JOB_ID_LENGTH);
}

/** Elapsed time since `startedAt` as "4 min 05 s"; no estimate of the remaining time. */
export function formatElapsed(startedAt: string, now = Date.now()): string {
  const totalSeconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  if (hours > 0) {
    return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  }

  return minutes > 0 ? `${minutes} min ${seconds} s` : `${totalSeconds % 60} s`;
}
