import { describe, expect, it, vi } from 'vitest';

import { createApiClient, type TransportRequest } from '../auth/apiClient';
import {
  createJobsApi,
  formatBytes,
  formatElapsed,
  humanize,
  JOB_PAGE_SIZE,
  shortJobId,
} from './jobsApi';
import { shouldPoll } from './useJobPolling';

describe('jobs API client (US-020, US-021)', () => {
  it('cancels with POST /jobs/{id}/cancel and the CSRF header', async () => {
    const requests: TransportRequest[] = [];
    const client = createApiClient({
      getCsrfToken: () => 'csrf-synthetic',
      onAuthenticationRequired: vi.fn(),
      onPasswordChangeRequired: vi.fn(),
      transport: (request) => {
        requests.push(request);
        return Promise.resolve({ body: { data: { job: { id: 'j' } } }, status: 200 });
      },
    });
    const api = createJobsApi(client);

    expect(await api.cancel('job/1')).toEqual({ job: { id: 'j' } });
    await api.list(2);

    expect(requests[0]).toMatchObject({
      headers: { 'X-CSRF-Token': 'csrf-synthetic' },
      method: 'POST',
      path: '/jobs/job%2F1/cancel',
    });
    expect(requests[1]?.path).toBe(`/jobs?page=2&limit=${JOB_PAGE_SIZE}`);
  });

  it('surfaces 409 CONFLICT for a finished job', async () => {
    const api = createJobsApi(
      createApiClient({
        getCsrfToken: () => 't',
        onAuthenticationRequired: vi.fn(),
        onPasswordChangeRequired: vi.fn(),
        transport: () =>
          Promise.resolve({
            body: {
              error: { code: 'CONFLICT', details: [], message: 'This job has already finished.' },
            },
            status: 409,
          }),
      }),
    );

    await expect(api.cancel('j')).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });
});

describe('overview helpers', () => {
  it('stops polling for CANCELLED like the other terminal statuses', () => {
    expect(shouldPoll('CANCELLED', false)).toBe(false);
    expect(shouldPoll('QUEUED', true)).toBe(false);
  });

  it('formats IDs, sizes, elapsed time and labels', () => {
    expect(shortJobId('cmgq1z3b40000abcd1234efgh')).toBe('1234efgh');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(65_536)).toBe('64.0 KB');
    expect(formatBytes(1_073_741_824)).toBe('1.0 GB');
    expect(formatElapsed('2026-10-18T01:00:00.000Z', Date.parse('2026-10-18T01:00:07.000Z'))).toBe(
      '7 s',
    );
    expect(formatElapsed('2026-10-18T01:00:00.000Z', Date.parse('2026-10-18T01:04:05.000Z'))).toBe(
      '4 min 05 s',
    );
    expect(formatElapsed('2026-10-18T01:00:00.000Z', Date.parse('2026-10-18T03:07:00.000Z'))).toBe(
      '2 h 07 min',
    );
    expect(formatElapsed('2026-10-18T01:00:00.000Z', Date.parse('2026-10-18T00:00:00.000Z'))).toBe(
      '0 s',
    );
    expect(humanize('BARCODE_FOLDERS')).toBe('Barcode folders');
  });
});
