import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiRequestError,
  createApiClient,
  fetchTransport,
  type TransportRequest,
  type TransportResponse,
} from '../auth/apiClient';
import {
  buildLaunchFormData,
  createPipelinesApi,
  LAYOUT_LABELS,
  unavailableMessage,
  UNAVAILABLE_REASON_MESSAGES,
} from './pipelinesApi';

const OPTIONS = {
  demultiplex: false,
  kitName: 'BiK-HLA114-96' as const,
  qScore: 14,
  qualityFilter: true,
};

function fakeClient(response: TransportResponse) {
  const requests: TransportRequest[] = [];
  const onAuthenticationRequired = vi.fn();
  const client = createApiClient({
    getCsrfToken: () => 'csrf-synthetic',
    onAuthenticationRequired,
    onPasswordChangeRequired: vi.fn(),
    transport: (request) => {
      requests.push(request);
      return Promise.resolve(response);
    },
  });

  return { client, onAuthenticationRequired, requests };
}

describe('buildLaunchFormData (design C3/C10 field order)', () => {
  it('sends fields, then the sheet under a fixed name, then FASTQ files by relative path', async () => {
    const sheet = new File(['barcode,alias\nbarcode01,s01\n'], 'my-private-name.csv');
    const formData = buildLaunchFormData(
      { layout: 'BARCODE_FOLDERS', options: OPTIONS, runName: 'Run 1', sampleName: '' },
      sheet,
      [
        { file: new File(['x'], 'a.fastq'), relativePath: 'run/barcode01/a.fastq' },
        { file: new File(['y'], 'b.fastq'), relativePath: 'run/barcode02/b.fastq' },
      ],
    );
    const entries = [...formData.entries()];

    expect(entries.map(([name]) => name)).toEqual([
      'runName',
      'layout',
      'options',
      'sampleSheet',
      'fastq',
      'fastq',
    ]);
    expect(JSON.parse(String(formData.get('options')))).toEqual(OPTIONS);
    expect((formData.get('sampleSheet') as File).name).toBe('sample_sheet.csv');
    expect(formData.getAll('fastq').map((file) => (file as File).name)).toEqual([
      'run/barcode01/a.fastq',
      'run/barcode02/b.fastq',
    ]);
    expect(await (formData.get('sampleSheet') as File).text()).toContain('barcode01,s01');
  });

  it('includes sampleName only when it is not empty', () => {
    const withName = buildLaunchFormData(
      { layout: 'SINGLE_FILE', options: OPTIONS, runName: 'r', sampleName: 's01' },
      null,
      [],
    );

    expect(withName.get('sampleName')).toBe('s01');
    expect(withName.has('sampleSheet')).toBe(false);
  });
});

describe('createPipelinesApi with the shared client (upload helper)', () => {
  it('posts multipart with CSRF + Idempotency-Key and lets the browser set Content-Type', async () => {
    const { client, requests } = fakeClient({
      body: { data: { job: { id: 'job-1' }, statusUrl: '/jobs/job-1' } },
      status: 201,
    });
    const progress = vi.fn();
    const formData = new FormData();
    const result = await createPipelinesApi(client).launch(
      'wf-renamefastq',
      formData,
      'key-1',
      progress,
    );

    expect(result).toEqual({ job: { id: 'job-1' }, statusUrl: '/jobs/job-1' });
    expect(requests[0]).toMatchObject({
      body: formData,
      method: 'POST',
      onUploadProgress: progress,
      path: '/pipelines/wf-renamefastq/runs',
    });
    expect(requests[0]?.headers).toEqual({
      Accept: 'application/json',
      'Idempotency-Key': 'key-1',
      'X-CSRF-Token': 'csrf-synthetic',
    });
  });

  it('encodes pipeline IDs in list/detail paths and never sends CSRF on GET', async () => {
    const { client, requests } = fakeClient({ body: { data: { items: [] } }, status: 200 });
    const api = createPipelinesApi(client);

    await api.list();
    await api.get('a/b');

    expect(requests.map((request) => request.path)).toEqual(['/pipelines', '/pipelines/a%2Fb']);
    expect(requests.every((request) => !('X-CSRF-Token' in request.headers))).toBe(true);
  });

  it('maps 503 and 400 envelopes to ApiRequestError with details, and 401 to the auth hook', async () => {
    const unavailable = fakeClient({
      body: { error: { code: 'SERVICE_UNAVAILABLE', details: [], message: 'Not available.' } },
      status: 503,
    });
    const invalid = fakeClient({
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          details: [{ field: 'sampleSheet', message: 'Mismatch.' }],
          message: 'Request validation failed.',
        },
      },
      status: 400,
    });
    const anonymous = fakeClient({
      body: { error: { code: 'AUTHENTICATION_REQUIRED', details: [], message: 'Sign in.' } },
      status: 401,
    });

    await expect(
      createPipelinesApi(unavailable.client).launch('wf-renamefastq', new FormData(), 'k'),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    await expect(
      createPipelinesApi(invalid.client).launch('wf-renamefastq', new FormData(), 'k'),
    ).rejects.toMatchObject({ details: [{ field: 'sampleSheet', message: 'Mismatch.' }] });
    await expect(createPipelinesApi(anonymous.client).list()).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    expect(anonymous.onAuthenticationRequired).toHaveBeenCalledTimes(1);
  });
});

describe('fetchTransport multipart path (XHR upload progress)', () => {
  const original = globalThis.XMLHttpRequest;

  afterEach(() => {
    globalThis.XMLHttpRequest = original;
  });

  it('sends FormData via XHR without Content-Type and reports upload progress', async () => {
    const seen: { method?: string; url?: string; headers: Record<string, string>; body?: unknown } =
      { headers: {} };

    class FakeXhr {
      public status = 0;
      public responseText = '';
      public readonly upload = new EventTarget();
      private readonly events = new EventTarget();

      public open(method: string, url: string) {
        seen.method = method;
        seen.url = url;
      }

      public setRequestHeader(name: string, value: string) {
        seen.headers[name] = value;
      }

      public addEventListener(type: string, listener: () => void) {
        this.events.addEventListener(type, listener);
      }

      public send(body: unknown) {
        seen.body = body;
        const progress = Object.assign(new Event('progress'), {
          lengthComputable: true,
          loaded: 5,
          total: 10,
        });
        this.upload.dispatchEvent(progress);
        this.status = 201;
        this.responseText = JSON.stringify({ data: { ok: true } });
        this.events.dispatchEvent(new Event('load'));
      }
    }

    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    const formData = new FormData();
    const progress = vi.fn();
    const response = await fetchTransport({
      body: formData,
      headers: { 'Content-Type': 'multipart/form-data', 'X-CSRF-Token': 't' },
      method: 'POST',
      onUploadProgress: progress,
      path: '/pipelines/wf-renamefastq/runs',
    });

    expect(seen).toEqual({
      body: formData,
      headers: { 'X-CSRF-Token': 't' },
      method: 'POST',
      url: '/api/v1/pipelines/wf-renamefastq/runs',
    });
    expect(progress).toHaveBeenCalledWith(5, 10);
    expect(response).toEqual({ body: { data: { ok: true } }, status: 201 });
  });
});

describe('catalog labels', () => {
  it('has a safe message for every unavailable reason and a generic fallback', () => {
    expect(Object.keys(UNAVAILABLE_REASON_MESSAGES).sort()).toEqual([
      'ASSETS_MISSING',
      'DOCKER_UNAVAILABLE',
      'NEXTFLOW_DISABLED',
      'NEXTFLOW_MISSING',
    ]);
    expect(unavailableMessage('DOCKER_UNAVAILABLE')).toBe('Docker is not running on this server.');
    expect(unavailableMessage(null)).toBe('This pipeline is not ready on this server.');
    expect(Object.keys(LAYOUT_LABELS)).toEqual(['SINGLE_FILE', 'SAMPLE_FOLDER', 'BARCODE_FOLDERS']);
  });
});
