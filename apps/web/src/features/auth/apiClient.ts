import type { ApiError, ErrorCode } from '@portal/shared';

export const API_BASE_PATH = '/api/v1';

export type UploadProgressHandler = (loaded: number, total: number) => void;

export type TransportRequest = {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  /** JSON-serialisable value, or `FormData` for multipart uploads. */
  body?: unknown;
  headers: Record<string, string>;
  /** Upload hook: called with bytes sent so far when `body` is `FormData`. */
  onUploadProgress?: UploadProgressHandler;
};

export type TransportResponse = {
  status: number;
  body: unknown;
};

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

type ErrorDetail = ApiError['error']['details'][number];

export class ApiRequestError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode | 'NETWORK_ERROR';
  public readonly details: readonly ErrorDetail[];

  public constructor(
    status: number,
    code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    details: readonly ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ApiClientOptions = {
  transport: Transport;
  getCsrfToken: () => string | null;
  onAuthenticationRequired: () => void;
  onPasswordChangeRequired: () => void;
};

export type ApiClient = {
  get: <T>(path: string) => Promise<T>;
  /** `headers` carries request-scoped headers such as `Idempotency-Key`. */
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => Promise<T>;
  delete: <T = null>(path: string) => Promise<T>;
  /**
   * Multipart POST with upload progress. The browser sets the multipart `Content-Type`
   * (with its boundary), so it is never set here.
   */
  upload: <T>(
    path: string,
    formData: FormData,
    headers?: Record<string, string>,
    onProgress?: UploadProgressHandler,
  ) => Promise<T>;
};

const GENERIC_ERROR_MESSAGE = 'Unable to complete the request. Please try again.';

export function createApiClient(options: ApiClientOptions): ApiClient {
  async function request<T>(
    method: TransportRequest['method'],
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
    onUploadProgress?: UploadProgressHandler,
  ) {
    const headers: Record<string, string> = { ...extraHeaders, Accept: 'application/json' };
    const csrfToken = options.getCsrfToken();

    if (body !== undefined && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    if (method !== 'GET' && csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    let response: TransportResponse;

    try {
      response = await options.transport(
        onUploadProgress
          ? { method, path, body, headers, onUploadProgress }
          : { method, path, body, headers },
      );
    } catch {
      throw new ApiRequestError(0, 'NETWORK_ERROR', 'The service is unreachable. Please retry.');
    }

    if (response.status >= 200 && response.status < 300) {
      return response.body as T;
    }

    const error = toApiRequestError(response);

    if (error.code === 'AUTHENTICATION_REQUIRED') {
      options.onAuthenticationRequired();
    }

    if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
      options.onPasswordChangeRequired();
    }

    throw error;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body, headers) => request('POST', path, body, headers),
    delete: (path) => request('DELETE', path),
    upload: (path, formData, headers, onProgress) =>
      request('POST', path, formData, headers, onProgress),
  };
}

export const fetchTransport: Transport = async (request) => {
  // fetch() cannot report upload progress, so multipart bodies go through XMLHttpRequest.
  if (request.body instanceof FormData) {
    return xhrUpload(request, request.body);
  }

  const { method, path, body, headers } = request;
  const response = await fetch(`${API_BASE_PATH}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    headers,
    method,
  });
  const text = response.status === 204 ? '' : await response.text();

  return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
};

/** Same-origin XHR (cookies are sent by default); rejects on network failure like fetch. */
function xhrUpload(request: TransportRequest, formData: FormData): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open(request.method, `${API_BASE_PATH}${request.path}`);

    for (const [name, value] of Object.entries(request.headers)) {
      if (name.toLowerCase() !== 'content-type') {
        xhr.setRequestHeader(name, value);
      }
    }

    const { onUploadProgress } = request;

    if (onUploadProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        onUploadProgress(event.loaded, event.lengthComputable ? event.total : 0);
      });
    }

    xhr.addEventListener('load', () => {
      try {
        const text = xhr.status === 204 ? '' : xhr.responseText;
        resolve({ status: xhr.status, body: text ? (JSON.parse(text) as unknown) : null });
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Invalid response body.'));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted.')));
    xhr.addEventListener('timeout', () => reject(new Error('Upload timed out.')));
    xhr.send(formData);
  });
}

function toApiRequestError(response: TransportResponse): ApiRequestError {
  const envelope = response.body as Partial<ApiError> | null;
  const error = envelope?.error;

  if (!error || typeof error.code !== 'string') {
    return new ApiRequestError(response.status, 'INTERNAL_ERROR', GENERIC_ERROR_MESSAGE);
  }

  return new ApiRequestError(
    response.status,
    error.code,
    error.message || GENERIC_ERROR_MESSAGE,
    Array.isArray(error.details) ? error.details : [],
  );
}
