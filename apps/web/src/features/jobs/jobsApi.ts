import type {
  ApiSuccess,
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

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
