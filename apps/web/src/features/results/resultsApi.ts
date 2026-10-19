import type { ApiSuccess, JobResult, ResultArtifact } from '@portal/shared';

import { API_BASE_PATH, type ApiClient } from '../auth/apiClient';

/**
 * In mock mode (`VITE_API_MOCK=true`) no file is ever served: the UI shows
 * `ARTIFACT_MOCK_NOTE` instead of download links and the report frame (design C8, task 2.1).
 */
export const ARTIFACT_FILES_AVAILABLE = import.meta.env.VITE_API_MOCK !== 'true';
export const ARTIFACT_MOCK_NOTE = 'Not available in mock mode';

/** Typed call for `GET /api/v1/jobs/{jobId}/result` through the shared session client. */
export function createResultsApi(api: ApiClient) {
  return {
    /**
     * `409 CONFLICT` while the job is not COMPLETED (details carry the current status),
     * `410 GONE` when the result files are no longer available, `404` for unknown/foreign jobs.
     */
    getResult: async (jobId: string) =>
      (await api.get<ApiSuccess<JobResult>>(`/jobs/${encodeURIComponent(jobId)}/result`)).data,
  };
}

export type ResultsApi = ReturnType<typeof createResultsApi>;

function artifactPath(jobId: string, artifactId: string, mode: 'download' | 'view'): string {
  return `${API_BASE_PATH}/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}/${mode}`;
}

/** Same-origin attachment URL (the browser sends the session cookie). */
export function downloadUrl(jobId: string, artifact: Pick<ResultArtifact, 'id'>): string {
  return artifactPath(jobId, artifact.id, 'download');
}

/** Sandboxed report URL; only meaningful for artifacts with `viewable: true` (design C6). */
export function viewUrl(jobId: string, artifact: Pick<ResultArtifact, 'id'>): string {
  return artifactPath(jobId, artifact.id, 'view');
}
