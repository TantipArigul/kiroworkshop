import type {
  AuditEvent,
  AuthenticatedUser,
  JobDetail,
  JobSubmitRequest,
  JobSummary,
} from '@portal/shared';
import {
  INPUT_FILE_HEADER,
  INPUT_FILE_MAX_BYTES,
  INPUT_FILE_MAX_ROWS,
  INPUT_MARKERS,
} from '@portal/shared/constants';

import type {
  Transport,
  TransportResponse,
  UploadProgressHandler,
} from '../features/auth/apiClient';
import auditFixture from './audit-events.json';
import jobsFixture from './jobs.json';
import accountFixture from './me.json';

/**
 * Wave 2 mock adapter (VITE_API_MOCK=true). Holds a fake session in memory only, accepts any
 * password for the synthetic accounts in me.json and never stores or echoes passwords.
 */
const MOCK_LATENCY_MS = 350;
const MOCK_CSRF_TOKEN = 'mock-csrf-token-for-ui-review-only';
const MIN_PASSWORD_LENGTH = 12;
const accounts = accountFixture.accounts as AuthenticatedUser[];
const auditEvents = auditFixture.events as AuditEvent[];

let currentUser: AuthenticatedUser | null = null;

export const mockTransport: Transport = async ({
  method,
  path,
  body,
  headers,
  onUploadProgress,
}) => {
  if (body instanceof FormData) {
    await simulateUploadProgress(body, onUploadProgress);
  }

  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));

  const url = new URL(path, 'https://mock.invalid');
  const route = `${method} ${url.pathname}`;

  switch (route) {
    case 'GET /auth/csrf-token':
      return ok({ csrfToken: MOCK_CSRF_TOKEN });
    case 'POST /auth/login':
      return login(body as { email?: string; password?: string });
    case 'GET /auth/me':
      return currentUser ? ok(currentUser) : fail(401, 'AUTHENTICATION_REQUIRED');
    case 'POST /auth/logout':
      currentUser = null;
      return { status: 204, body: null };
    case 'POST /auth/password':
      return changePassword(body as { currentPassword?: string; newPassword?: string });
    case 'GET /audit-events':
      return listAuditEvents(url.searchParams);
    default:
      return routeJobs(method, url, body, headers['Idempotency-Key']);
  }
};

// ---------- Uploads (Pipeline Catalog upload hook) ----------

const UPLOAD_STEPS = 5;
const UPLOAD_STEP_MS = 150;

/** Reports upload progress in a few steps; the mock never reads file contents. */
async function simulateUploadProgress(
  formData: FormData,
  onUploadProgress: UploadProgressHandler | undefined,
) {
  let total = 0;

  for (const value of formData.values()) {
    total += typeof value === 'string' ? value.length : value.size;
  }

  for (let step = 1; step <= UPLOAD_STEPS; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_STEP_MS));
    onUploadProgress?.(Math.round((total * step) / UPLOAD_STEPS), total);
  }
}

// ---------- Jobs (Submission & Job Lifecycle, Wave 2 mock) ----------

type MockJob = JobDetail & { mockCreatedAtMs?: number };

const QUEUED_MS = 3_000;
const RUNNING_MS = 5_000;
/** Pipeline Catalog DTO fields for Smart Checkup jobs (fixtures predate them). */
function withSmartCheckupDefaults<T extends { sampleLabel: string }>(job: T) {
  return {
    cancellable: false,
    outputs: null,
    pipelineId: 'smart-checkup' as const,
    pipelineName: 'Smart Checkup',
    progress: null,
    queuePosition: null,
    run: null,
    runName: job.sampleLabel,
    ...job,
  };
}

type PipelineCatalogFields =
  | 'cancellable'
  | 'outputs'
  | 'pipelineId'
  | 'pipelineName'
  | 'progress'
  | 'queuePosition'
  | 'run'
  | 'runName';

const jobs: MockJob[] = (jobsFixture.jobs as Omit<JobDetail, PipelineCatalogFields>[]).map(
  (job) => withSmartCheckupDefaults(job) as MockJob,
);
const submittedKeys = new Map<string, string>();

function routeJobs(
  method: string,
  url: URL,
  body: unknown,
  idempotencyKey: string | undefined,
): TransportResponse {
  if (!url.pathname.startsWith('/jobs')) {
    return fail(404, 'NOT_FOUND');
  }

  if (!currentUser) {
    return fail(401, 'AUTHENTICATION_REQUIRED');
  }

  if (currentUser.passwordChangeRequired) {
    return fail(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password to continue.');
  }

  const jobId = url.pathname.split('/')[2];

  if (method === 'GET' && url.pathname === '/jobs/sample-input') {
    return ok({
      ...jobsFixture.sample,
      format: {
        header: INPUT_FILE_HEADER,
        maxBytes: INPUT_FILE_MAX_BYTES,
        maxRows: INPUT_FILE_MAX_ROWS,
        markers: INPUT_MARKERS,
      },
    });
  }

  if (method === 'GET' && url.pathname === '/jobs') {
    const page = Number(url.searchParams.get('page') ?? '1');
    const limit = Number(url.searchParams.get('limit') ?? '20');
    const items = jobs
      .map(advance)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map(toSummary);

    return ok({
      items: items.slice((page - 1) * limit, page * limit),
      page,
      limit,
      total: items.length,
    });
  }

  if (method === 'POST' && url.pathname === '/jobs') {
    return submitJob(body as JobSubmitRequest, idempotencyKey ?? crypto.randomUUID());
  }

  const job = jobs.find((candidate) => candidate.id === jobId);

  if (!job) {
    return fail(404, 'NOT_FOUND', 'This job is unavailable.');
  }

  if (method === 'GET') {
    return ok(advance(job));
  }

  if (method === 'DELETE') {
    jobs.splice(jobs.indexOf(job), 1);
    return { status: 204, body: null };
  }

  return fail(404, 'NOT_FOUND');
}

function submitJob(input: JobSubmitRequest, key: string): TransportResponse {
  const existing = submittedKeys.get(key);

  if (existing) {
    const job = jobs.find((candidate) => candidate.id === existing);
    return job ? ok({ job: toSummary(job), statusUrl: job.statusUrl }) : fail(404, 'NOT_FOUND');
  }

  if (!input?.file?.content.startsWith(INPUT_FILE_HEADER)) {
    return fail(400, 'VALIDATION_FAILED', 'Request validation failed.', [
      { field: 'file', message: `The first line must be "${INPUT_FILE_HEADER}".` },
    ]);
  }

  const now = new Date();
  const id = `cmock${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(
    0,
    25,
  );
  const rows = input.file.content.trim().split(/\r?\n/).length - 1;
  const parameters = {
    lifestyleFactors: [],
    simulateFailure: false,
    ...input.parameters,
  } as NonNullable<JobDetail['parameters']>;
  const job: MockJob = {
    ...withSmartCheckupDefaults({ sampleLabel: parameters.sampleLabel }),
    id,
    status: 'QUEUED',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    parameters,
    file: { name: input.file.name, sizeBytes: input.file.content.length, rowCount: rows },
    history: [
      { status: 'QUEUED', occurredAt: now.toISOString(), summary: 'Job accepted and queued.' },
    ],
    failureSummary: null,
    statusUrl: `/jobs/${id}`,
    mockCreatedAtMs: now.getTime(),
  };

  jobs.push(job);
  submittedKeys.set(key, id);

  return {
    status: 201,
    body: {
      data: { job: toSummary(job), statusUrl: job.statusUrl },
      meta: { requestId: crypto.randomUUID() },
    },
  };
}

/** Moves a freshly submitted mock job along QUEUED → RUNNING → COMPLETED/FAILED by elapsed time. */
function advance(job: MockJob): MockJob {
  if (!job.mockCreatedAtMs) {
    return job;
  }

  const created = job.mockCreatedAtMs;
  const elapsed = Date.now() - created;
  const at = (offset: number) => new Date(created + offset).toISOString();

  if (job.status === 'QUEUED' && elapsed >= QUEUED_MS) {
    job.status = 'RUNNING';
    job.updatedAt = at(QUEUED_MS);
    job.history.push({
      status: 'RUNNING',
      occurredAt: job.updatedAt,
      summary: 'Simulated pipeline started.',
    });
  }

  if (job.status === 'RUNNING' && elapsed >= QUEUED_MS + RUNNING_MS) {
    const failed = job.parameters?.simulateFailure ?? false;
    const summary = failed
      ? 'Simulated pipeline failure requested by the training option. Submit again without it to complete.'
      : 'Analysis completed.';
    job.status = failed ? 'FAILED' : 'COMPLETED';
    job.updatedAt = at(QUEUED_MS + RUNNING_MS);
    job.failureSummary = failed ? summary : null;
    job.history.push({ status: job.status, occurredAt: job.updatedAt, summary });
  }

  return job;
}

function toSummary(job: JobDetail): JobSummary {
  const {
    createdAt,
    expiresAt,
    id,
    pipelineId,
    pipelineName,
    progress,
    queuePosition,
    runName,
    sampleLabel,
    status,
    updatedAt,
  } = job;
  return {
    createdAt,
    expiresAt,
    id,
    pipelineId,
    pipelineName,
    progress,
    queuePosition,
    runName,
    sampleLabel,
    status,
    updatedAt,
  };
}

function login(input: { email?: string; password?: string }): TransportResponse {
  const email = input.email?.trim().toLowerCase();
  const account = accounts.find((candidate) => candidate.email === email);

  if (!account || !input.password) {
    return fail(401, 'AUTHENTICATION_FAILED', 'The e-mail or password is incorrect.');
  }

  currentUser = { ...account };

  return ok({ user: currentUser, csrfToken: MOCK_CSRF_TOKEN });
}

function changePassword(input: {
  currentPassword?: string;
  newPassword?: string;
}): TransportResponse {
  if (!currentUser) {
    return fail(401, 'AUTHENTICATION_REQUIRED');
  }

  const newPassword = input.newPassword ?? '';
  const details: { field: string; message: string }[] = [];

  if (Array.from(newPassword).length < MIN_PASSWORD_LENGTH) {
    details.push({ field: 'newPassword', message: 'Use at least 12 characters.' });
  }

  if (newPassword.toLowerCase() === currentUser.email) {
    details.push({ field: 'newPassword', message: 'Do not use your e-mail address.' });
  }

  if (details.length > 0) {
    return fail(400, 'VALIDATION_FAILED', 'Choose a different password.', details);
  }

  currentUser = { ...currentUser, passwordChangeRequired: false };

  return { status: 204, body: null };
}

function listAuditEvents(params: URLSearchParams): TransportResponse {
  if (!currentUser) {
    return fail(401, 'AUTHENTICATION_REQUIRED');
  }

  if (currentUser.passwordChangeRequired) {
    return fail(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password to continue.');
  }

  if (!currentUser.permissions.includes('AUDIT_READ')) {
    return fail(403, 'AUTHORIZATION_DENIED', 'You do not have access to audit events.');
  }

  const from = params.get('from');
  const to = params.get('to');
  const filtered = auditEvents.filter(
    (event) =>
      matches(event.eventType, params.get('eventType')) &&
      matches(event.outcome, params.get('outcome')) &&
      matches(event.actorId ?? '', params.get('actorId')) &&
      matches(event.resourceType, params.get('resourceType')) &&
      (!from || Date.parse(event.occurredAt) >= Date.parse(from)) &&
      (!to || Date.parse(event.occurredAt) <= Date.parse(to)),
  );
  const page = Number(params.get('page') ?? '1');
  const limit = Number(params.get('limit') ?? '20');

  return ok({
    items: filtered.slice((page - 1) * limit, page * limit),
    page,
    limit,
    total: filtered.length,
  });
}

function matches(value: string, filter: string | null): boolean {
  return !filter || value === filter;
}

function ok(data: unknown): TransportResponse {
  return { status: 200, body: { data, meta: { requestId: crypto.randomUUID() } } };
}

function fail(
  status: number,
  code: string,
  message = 'Unable to complete the request.',
  details: { field: string; message: string }[] = [],
): TransportResponse {
  return {
    status,
    body: { error: { code, message, details }, meta: { requestId: crypto.randomUUID() } },
  };
}
