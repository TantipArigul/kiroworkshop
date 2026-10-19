import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../auth/apiClient';
import { createResultsApi, downloadUrl, viewUrl } from './resultsApi';

describe('resultsApi', () => {
  it('builds encoded same-origin download and view URLs', () => {
    expect(downloadUrl('cjob1', { id: 'cart1' })).toBe(
      '/api/v1/jobs/cjob1/artifacts/cart1/download',
    );
    expect(viewUrl('cjob1', { id: 'cart1' })).toBe('/api/v1/jobs/cjob1/artifacts/cart1/view');
    expect(downloadUrl('a/../b', { id: 'x?y#z' })).toBe(
      '/api/v1/jobs/a%2F..%2Fb/artifacts/x%3Fy%23z/download',
    );
  });

  it('loads GET /jobs/{id}/result once and returns the envelope data', async () => {
    const calls: string[] = [];
    const api = {
      get: async (path: string) => {
        calls.push(path);
        return { data: { pipelineId: 'smart-checkup' }, meta: { requestId: 'r' } };
      },
    } as unknown as ApiClient;
    expect(await createResultsApi(api).getResult('c job/1')).toEqual({
      pipelineId: 'smart-checkup',
    });
    expect(calls).toEqual(['/jobs/c%20job%2F1/result']);
  });
});
