import type {
  AuditEvent,
  AuthenticatedUser,
  JobDetail,
  JobResult,
  JobSubmitRequest,
  JobSummary,
  NextflowResult,
  PipelineDetail,
  PipelineId,
  PipelineSummary,
  RenamefastqOptions,
  ResultArtifact,
  RunInputLayout,
  SmartCheckupResult,
} from '@portal/shared';
import {
  FASTQ_EXTENSIONS,
  INPUT_FILE_HEADER,
  INPUT_FILE_MAX_BYTES,
  INPUT_FILE_MAX_ROWS,
  INPUT_MARKERS,
  NO_MOCK_RECOMMENDATION_RULE_ID,
  RENAMEFASTQ_DEFAULT_KIT_NAME,
  RENAMEFASTQ_DEFAULT_Q_SCORE,
  RENAMEFASTQ_KIT_NAMES,
  RENAMEFASTQ_Q_SCORE_MAX,
  RENAMEFASTQ_Q_SCORE_MIN,
  RUN_INPUT_LAYOUTS,
  RUN_INPUT_MAX_BYTES,
  RUN_INPUT_MAX_FASTQ_FILES,
  SAMPLE_SHEET_MAX_BYTES,
} from '@portal/shared/constants';
import {
  checkLaunchRules,
  classifyLayoutAs,
  isValidSampleName,
  matchSheetToFolders,
  normalizeRunName,
  parseSampleSheet,
} from '@portal/shared/run-input';

import type {
  Transport,
  TransportResponse,
  UploadProgressHandler,
} from '../features/auth/apiClient';
import auditFixture from './audit-events.json';
import jobsFixture from './jobs.json';
import accountFixture from './me.json';
import pipelinesFixture from './pipelines.json';
import resultsFixture from './results.json';

/**
 * Wave 2 mock adapter (VITE_API_MOCK=true). Holds a fake session in memory only, accepts any
 * password for the synthetic accounts in me.json and never stores or echoes passwords.
 * Uploaded FASTQ files are never read: only their relative path and size are used.
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
      if (url.pathname.startsWith('/pipelines')) {
        return routePipelines(method, url, body, headers['Idempotency-Key'], onUploadProgress);
      }

      return routeJobs(method, url, body, headers['Idempotency-Key']);
  }
};

// ---------- Uploads ----------

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

// ---------- Jobs (simulated time line) ----------

/**
 * Mock-only scheduling fields. Fixture jobs have none and never change; jobs created in this
 * session move QUEUED → RUNNING → COMPLETED by elapsed time. Nextflow jobs run one at a time
 * (capacity 1, ordered by creation) like `NEXTFLOW_MAX_CONCURRENT_RUNS=1`.
 */
type MockSchedule = {
  mockCreatedAtMs?: number;
  mockStartAtMs?: number;
  mockFinishAtMs?: number;
  mockSteps?: string[];
  /** Synthetic marker CSV of a session-created Smart Checkup job, used to build its result. */
  mockCsv?: string;
};
type MockJob = JobDetail & MockSchedule;

const QUEUED_MS = 3_000;
const SIMULATED_RUNNING_MS = 5_000;
const NEXTFLOW_STEP_MS = 5_000;
const RETENTION_MS = 7 * 86_400_000;
const CANCELLED_SUMMARY = 'Cancelled by the owner.';

type PipelineCatalogFields =
  | 'cancellable'
  | 'outputs'
  | 'pipelineId'
  | 'pipelineName'
  | 'progress'
  | 'queuePosition'
  | 'run'
  | 'runName';

/** Pipeline Catalog DTO fields for Smart Checkup jobs (older fixtures predate them). */
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

const jobs: MockJob[] = (
  jobsFixture.jobs as unknown as (Omit<JobDetail, PipelineCatalogFields> &
    Partial<Pick<JobDetail, PipelineCatalogFields>>)[]
).map((job) => withSmartCheckupDefaults(job) as MockJob);
const submittedKeys = new Map<string, string>();

function requireSession(): TransportResponse | null {
  if (!currentUser) {
    return fail(401, 'AUTHENTICATION_REQUIRED');
  }

  if (currentUser.passwordChangeRequired) {
    return fail(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password to continue.');
  }

  return null;
}

function routeJobs(
  method: string,
  url: URL,
  body: unknown,
  idempotencyKey: string | undefined,
): TransportResponse {
  if (!url.pathname.startsWith('/jobs')) {
    return fail(404, 'NOT_FOUND');
  }

  const denied = requireSession();

  if (denied) {
    return denied;
  }

  advanceAll();

  const [, , jobId, action] = url.pathname.split('/');

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
    const items = [...jobs]
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

  if (method === 'POST' && action === 'cancel') {
    return cancelJob(job);
  }

  if (method === 'GET' && action === 'result' && url.pathname.split('/').length === 4) {
    return resultFor(job);
  }

  if (action === 'artifacts') {
    // Mock mode never serves file contents; the UI shows "Not available in mock mode".
    return fail(404, 'NOT_FOUND', 'Not available in mock mode.');
  }

  if (action !== undefined) {
    return fail(404, 'NOT_FOUND');
  }

  if (method === 'GET') {
    return ok(toDetail(job));
  }

  if (method === 'DELETE') {
    jobs.splice(jobs.indexOf(job), 1);
    rescheduleNextflowQueue(Date.now());
    return { status: 204, body: null };
  }

  return fail(404, 'NOT_FOUND');
}

function newMockJobId(): string {
  return `cmock${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 25);
}

function submitJob(input: JobSubmitRequest, key: string): TransportResponse {
  const existing = replay(key);

  if (existing) {
    return existing;
  }

  if (!input?.file?.content.startsWith(INPUT_FILE_HEADER)) {
    return fail(400, 'VALIDATION_FAILED', 'Request validation failed.', [
      { field: 'file', message: `The first line must be "${INPUT_FILE_HEADER}".` },
    ]);
  }

  const now = Date.now();
  const id = newMockJobId();
  const rows = input.file.content.trim().split(/\r?\n/).length - 1;
  const parameters = {
    lifestyleFactors: [],
    simulateFailure: false,
    ...input.parameters,
  } as NonNullable<JobDetail['parameters']>;
  const job: MockJob = {
    ...withSmartCheckupDefaults({ sampleLabel: parameters.sampleLabel }),
    ...queuedTimestamps(id, now),
    parameters,
    file: { name: input.file.name, sizeBytes: input.file.content.length, rowCount: rows },
    mockCsv: input.file.content,
    mockCreatedAtMs: now,
    mockStartAtMs: now + QUEUED_MS,
    mockFinishAtMs: now + QUEUED_MS + SIMULATED_RUNNING_MS,
  };

  return accept(job, key);
}

function queuedTimestamps(id: string, now: number) {
  const iso = new Date(now).toISOString();

  return {
    cancellable: true,
    createdAt: iso,
    expiresAt: new Date(now + RETENTION_MS).toISOString(),
    failureSummary: null,
    history: [{ status: 'QUEUED' as const, occurredAt: iso, summary: 'Job accepted and queued.' }],
    id,
    status: 'QUEUED' as const,
    statusUrl: `/jobs/${id}`,
    updatedAt: iso,
  };
}

function replay(key: string): TransportResponse | null {
  const existingId = submittedKeys.get(key);

  if (!existingId) {
    return null;
  }

  const job = jobs.find((candidate) => candidate.id === existingId);

  return job ? ok({ job: toSummary(job), statusUrl: job.statusUrl }) : fail(404, 'NOT_FOUND');
}

function accept(job: MockJob, key: string): TransportResponse {
  jobs.push(job);
  submittedKeys.set(key, job.id);
  rescheduleNextflowQueue(Date.now());

  return {
    status: 201,
    body: {
      data: { job: toSummary(job), statusUrl: job.statusUrl },
      meta: { requestId: crypto.randomUUID() },
    },
  };
}

function cancelJob(job: MockJob): TransportResponse {
  if (job.status !== 'QUEUED' && job.status !== 'RUNNING') {
    return fail(409, 'CONFLICT', 'This job has already finished.');
  }

  const now = new Date();
  job.status = 'CANCELLED';
  job.updatedAt = now.toISOString();
  job.cancellable = false;
  // Like the API: progress is reported only while RUNNING.
  job.progress = null;
  job.history.push({ status: 'CANCELLED', occurredAt: job.updatedAt, summary: CANCELLED_SUMMARY });
  rescheduleNextflowQueue(now.getTime());

  return ok({ job: toSummary(job) });
}

function isNextflow(job: JobDetail): boolean {
  return job.pipelineId === 'wf-renamefastq';
}

/** Re-plans the start/finish of QUEUED Nextflow jobs after a launch, cancel or delete. */
function rescheduleNextflowQueue(now: number) {
  const scheduled = jobs.filter((job) => isNextflow(job) && job.mockCreatedAtMs !== undefined);
  const running = scheduled.find((job) => job.status === 'RUNNING');
  let freeAt = running?.mockFinishAtMs ?? now;

  for (const job of scheduled
    .filter((candidate) => candidate.status === 'QUEUED')
    .sort((a, b) => (a.mockCreatedAtMs ?? 0) - (b.mockCreatedAtMs ?? 0))) {
    job.mockStartAtMs = Math.max((job.mockCreatedAtMs ?? now) + QUEUED_MS, freeAt);
    job.mockFinishAtMs = job.mockStartAtMs + (job.mockSteps?.length ?? 1) * NEXTFLOW_STEP_MS;
    freeAt = job.mockFinishAtMs;
  }
}

function advanceAll() {
  const now = Date.now();
  jobs.forEach((job) => advance(job, now));
}

/** Moves a session-created job along its planned time line; fixture jobs never change. */
function advance(job: MockJob, now: number) {
  const { mockFinishAtMs: finishAt, mockStartAtMs: startAt } = job;

  if (startAt === undefined || finishAt === undefined) {
    return;
  }

  const at = (ms: number) => new Date(ms).toISOString();

  if (job.status === 'QUEUED' && now >= startAt) {
    job.status = 'RUNNING';
    job.updatedAt = at(startAt);
    job.history.push({
      status: 'RUNNING',
      occurredAt: job.updatedAt,
      summary: isNextflow(job) ? 'Run started.' : 'Simulated pipeline started.',
    });
  }

  if (job.status === 'RUNNING' && isNextflow(job)) {
    const steps = job.mockSteps ?? [];
    const completedSteps = Math.min(steps.length, Math.floor((now - startAt) / NEXTFLOW_STEP_MS));

    if (job.progress?.completedSteps !== completedSteps || !job.progress) {
      job.progress = {
        completedSteps,
        currentStep: steps[completedSteps] ?? null,
        startedAt: at(startAt),
      };
      job.updatedAt = at(startAt + completedSteps * NEXTFLOW_STEP_MS);
    }
  }

  if (job.status === 'RUNNING' && now >= finishAt) {
    finish(job, at(finishAt));
  }
}

function finish(job: MockJob, occurredAt: string) {
  const failed = job.parameters?.simulateFailure ?? false;
  const summary = failed
    ? 'Simulated pipeline failure requested by the training option. Submit again without it to complete.'
    : isNextflow(job)
      ? 'Run completed.'
      : 'Analysis completed.';

  job.status = failed ? 'FAILED' : 'COMPLETED';
  job.updatedAt = occurredAt;
  job.cancellable = false;
  job.progress = null;
  job.failureSummary = failed ? summary : null;
  job.history.push({ status: job.status, occurredAt, summary });

  if (isNextflow(job) && job.run && !failed) {
    // Same file list as the result page, so the totals on the job page match it.
    const artifacts = sessionNextflowOutputs(job).artifacts;
    job.outputs = {
      fileCount: artifacts.length,
      totalBytes: artifacts.reduce((sum, file) => sum + file.sizeBytes, 0),
    };
  }
}

// ---------- Results (design C8 mock) ----------

const fixtureResults = resultsFixture.results as unknown as Record<string, JobResult>;
const RULESET_VERSION = 'mock-rules-2026.10-1';
const RECOMMENDATION_DISCLAIMER =
  'Training output only. Not a medical diagnosis or treatment advice.';
const GONE_MESSAGE =
  'The result files were removed by the retention policy or are no longer available.';
const CARDIO_MARKERS = [
  'fasting_glucose',
  'hba1c',
  'ldl_cholesterol',
  'triglycerides',
  'systolic_bp',
  'bmi',
];
/** Reference lists are copied from the fixtures so every mock result uses the same links. */
const SMART_CHECKUP_REFERENCES = fixtureResults.cmockjob0000000000000001?.references ?? [];
const NEXTFLOW_REFERENCES = fixtureResults.cmockjob0000000000000003?.references ?? [];

/**
 * `GET /jobs/{id}/result`: `409` until COMPLETED, the fixture result for fixture jobs, a result
 * built from the session input for jobs created in this session, and `410` for the fixture job
 * that completed before results existed (design C5/C7).
 */
function resultFor(job: MockJob): TransportResponse {
  if (job.status !== 'COMPLETED') {
    return fail(409, 'CONFLICT', 'The result is available only after the job has completed.', [
      { field: 'status', message: job.status },
    ]);
  }

  const fixture = fixtureResults[job.id];

  if (fixture) {
    return ok(fixture);
  }

  if (job.mockCreatedAtMs === undefined) {
    return fail(410, 'GONE', GONE_MESSAGE);
  }

  return ok(isNextflow(job) ? sessionNextflowResult(job) : sessionSmartCheckupResult(job));
}

type ResultMarker = SmartCheckupResult['markers'][number];

function sessionSmartCheckupResult(job: MockJob): SmartCheckupResult {
  const parameters = job.parameters!;
  const markers = parseMarkers(job.mockCsv ?? '');
  const recommendation = mockRecommendation(parameters, markers);

  return {
    pipelineId: 'smart-checkup',
    summary: {
      runName: job.runName,
      focusArea: parameters.focusArea,
      ageBand: parameters.ageBand,
      lifestyleFactors: parameters.lifestyleFactors,
      markerCount: markers.length,
      generatedAt: job.updatedAt,
    },
    markers,
    recommendation,
    artifacts: [
      {
        id: `${job.id}r1`,
        kind: 'RESULT',
        category: 'RESULT',
        displayName: `smart-checkup-result-${job.id.slice(-8)}.json`,
        sizeBytes: JSON.stringify({ markers, recommendation }).length,
        contentType: 'application/json',
        viewable: false,
        viewNote: null,
      },
    ],
    references: SMART_CHECKUP_REFERENCES,
  };
}

/** Rows were validated on submit; unknown markers are skipped like the server would reject them. */
function parseMarkers(csv: string): ResultMarker[] {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .flatMap((line) => {
      const [name = '', value = ''] = line.split(',');
      const definition = INPUT_MARKERS.find((item) => item.marker === name.trim());
      const numeric = Number(value);

      if (!definition || !Number.isFinite(numeric)) {
        return [];
      }

      const midpoint = (definition.min + definition.max) / 2;

      return [
        {
          marker: definition.marker,
          value: numeric,
          unit: definition.unit,
          min: definition.min,
          max: definition.max,
          midpoint,
          band:
            numeric >= midpoint
              ? ('AT_OR_ABOVE_TRAINING_MIDPOINT' as const)
              : ('BELOW_TRAINING_MIDPOINT' as const),
        },
      ];
    });
}

/** UI-review mirror of the C2 rule table (priority first-match); the API owns the real rules. */
function mockRecommendation(
  parameters: NonNullable<JobDetail['parameters']>,
  markers: ResultMarker[],
): SmartCheckupResult['recommendation'] {
  const above = (marker: string) =>
    markers.some((item) => item.marker === marker && item.band === 'AT_OR_ABOVE_TRAINING_MIDPOINT');
  const has = (factor: string) => (parameters.lifestyleFactors as string[]).includes(factor);
  const focus = parameters.focusArea;
  const markerFactors = (names: string[]) => names.filter(above).map((name) => `marker:${name}`);
  const lifestyleFactors = (names: string[]) =>
    names.filter(has).map((name) => `lifestyle:${name}`);
  const rules: { ruleId: string; packageLabel: string; factors: () => string[] | null }[] = [
    {
      ruleId: 'MOCK-CARDIO-01',
      packageLabel: 'Training Package B — Cardiometabolic',
      factors: () => {
        const hits = markerFactors(CARDIO_MARKERS);
        return focus === 'CARDIOMETABOLIC' && hits.length > 0
          ? ['focusArea:CARDIOMETABOLIC', ...hits]
          : null;
      },
    },
    {
      ruleId: 'MOCK-LIVER-01',
      packageLabel: 'Training Package C — Liver',
      factors: () => {
        const hits = [...markerFactors(['alt']), ...lifestyleFactors(['HIGH_ALCOHOL'])];
        return focus === 'LIVER' && hits.length > 0 ? ['focusArea:LIVER', ...hits] : null;
      },
    },
    {
      ruleId: 'MOCK-KIDNEY-01',
      packageLabel: 'Training Package D — Kidney',
      factors: () => {
        const hits = markerFactors(['creatinine', 'systolic_bp']);
        return focus === 'KIDNEY' && hits.length > 0 ? ['focusArea:KIDNEY', ...hits] : null;
      },
    },
    {
      ruleId: 'MOCK-LIFESTYLE-01',
      packageLabel: 'Training Package E — Lifestyle',
      factors: () => {
        const hits = lifestyleFactors(['SMOKING', 'LOW_ACTIVITY']);
        return hits.length > 0 ? hits : null;
      },
    },
    {
      ruleId: 'MOCK-GENERAL-01',
      packageLabel: 'Training Package A — General',
      factors: () => (focus === 'GENERAL' ? ['focusArea:GENERAL'] : null),
    },
  ];

  for (const rule of rules) {
    const factors = rule.factors();

    if (factors) {
      return {
        ruleId: rule.ruleId,
        ruleVersion: RULESET_VERSION,
        packageLabel: rule.packageLabel,
        reason: `Rule ${rule.ruleId} matched on ${factors.join(', ')}.`,
        matchedFactors: factors,
        matched: true,
        disclaimer: RECOMMENDATION_DISCLAIMER,
      };
    }
  }

  return {
    ruleId: NO_MOCK_RECOMMENDATION_RULE_ID,
    ruleVersion: RULESET_VERSION,
    packageLabel: 'No mock recommendation',
    reason: 'No mock rule matches this input, so no package is recommended.',
    matchedFactors: [],
    matched: false,
    disclaimer: RECOMMENDATION_DISCLAIMER,
  };
}

const SYNTHETIC_BYTES_PER_READ = 440;
const SYNTHETIC_AVG_LEN = 4200;

/** Synthetic per-sample stats and output list derived from FASTQ sizes only (never contents). */
function sessionNextflowOutputs(job: MockJob): {
  samples: NextflowResult['samples'];
  artifacts: ResultArtifact[];
} {
  const run = job.run!;
  const bytesBySample = new Map<string, number>();

  for (const file of run.files.filter((candidate) => candidate.kind === 'FASTQ')) {
    const folder = file.relativePath.split('/').slice(-2, -1)[0];
    const sample = run.sampleName ?? folder ?? 'sample';
    bytesBySample.set(sample, (bytesBySample.get(sample) ?? 0) + file.sizeBytes);
  }

  const samples = [...bytesBySample].map(([sample, bytes]) => {
    const numSeqs = Math.max(1, Math.round(bytes / SYNTHETIC_BYTES_PER_READ));
    return {
      sample,
      numSeqs,
      sumLen: numSeqs * SYNTHETIC_AVG_LEN,
      minLen: 180,
      avgLen: SYNTHETIC_AVG_LEN,
      maxLen: 15000,
      avgQual: 13.5,
    };
  });
  // Nextflow-style report suffix, e.g. 2026-10-18_02-00-04.
  const timestamp = job.createdAt.slice(0, 19).replace('T', '_').replace(/:/g, '-');
  const output = (
    index: number,
    category: ResultArtifact['category'],
    displayName: string,
    sizeBytes: number,
    contentType: string,
    viewable = false,
    viewNote: string | null = null,
  ): ResultArtifact => ({
    id: `${job.id}a${index}`,
    kind: 'OUTPUT',
    category,
    displayName,
    sizeBytes,
    contentType,
    viewable,
    viewNote,
  });
  const reads = samples.map((sample, index) =>
    output(
      index,
      'READS',
      `fastq/${sample.sample}.fastq.gz`,
      bytesBySample.get(sample.sample) ?? 0,
      'application/gzip',
    ),
  );
  const next = reads.length;

  return {
    samples,
    artifacts: [
      ...reads,
      output(
        next,
        'STATS',
        'stats/all_fastq_statistics.tsv',
        64 + 48 * samples.length,
        'text/tab-separated-values',
      ),
      output(
        next + 1,
        'REPORT',
        `pipeline_info/execution_report_${timestamp}.html`,
        1_600_000,
        'text/html',
        true,
      ),
      output(
        next + 2,
        'REPORT',
        `pipeline_info/execution_timeline_${timestamp}.html`,
        250_000,
        'text/html',
        true,
      ),
      output(
        next + 3,
        'REPORT',
        `pipeline_info/pipeline_dag_${timestamp}.html`,
        9_000,
        'text/html',
        false,
        'This report loads scripts from the internet, so it can only be downloaded.',
      ),
    ],
  };
}

function sessionNextflowResult(job: MockJob): NextflowResult {
  const { artifacts, samples } = sessionNextflowOutputs(job);

  return {
    pipelineId: 'wf-renamefastq',
    summary: {
      runName: job.runName,
      sampleCount: samples.length,
      totalReads: samples.reduce((sum, sample) => sum + sample.numSeqs, 0),
      totalBases: samples.reduce((sum, sample) => sum + sample.sumLen, 0),
      outputFileCount: artifacts.length,
      outputBytes: artifacts.reduce((sum, file) => sum + file.sizeBytes, 0),
    },
    samples,
    artifacts,
    references: NEXTFLOW_REFERENCES,
  };
}

/** 1-based position among QUEUED jobs of the same executor, by creation time. */
function queuePosition(job: JobDetail): number | null {
  if (job.status !== 'QUEUED') {
    return null;
  }

  return (
    jobs.filter(
      (other) =>
        other.status === 'QUEUED' &&
        isNextflow(other) === isNextflow(job) &&
        Date.parse(other.createdAt) < Date.parse(job.createdAt),
    ).length + 1
  );
}

function toDetail(job: MockJob): JobDetail {
  const { mockCreatedAtMs, mockCsv, mockFinishAtMs, mockStartAtMs, mockSteps, ...detail } = job;
  void [mockCreatedAtMs, mockCsv, mockFinishAtMs, mockStartAtMs, mockSteps];

  return { ...detail, queuePosition: queuePosition(job) };
}

function toSummary(job: JobDetail): JobSummary {
  const {
    createdAt,
    expiresAt,
    id,
    pipelineId,
    pipelineName,
    progress,
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
    queuePosition: queuePosition(job),
    runName,
    sampleLabel,
    status,
    updatedAt,
  };
}

// ---------- Pipelines (catalog, launch) ----------

type PipelineFixture = Omit<PipelineDetail, 'limits'>;

const pipelines = pipelinesFixture.pipelines as unknown as PipelineFixture[];
const NEXTFLOW_LIMITS: NonNullable<PipelineDetail['limits']> = {
  fastqExtensions: [...FASTQ_EXTENSIONS],
  maxFastqFiles: RUN_INPUT_MAX_FASTQ_FILES,
  maxTotalBytes: RUN_INPUT_MAX_BYTES,
  sampleSheetMaxBytes: SAMPLE_SHEET_MAX_BYTES,
};

/**
 * UI review switch for the unavailable states: open a page with `?mockUnavailable=1` (catalog,
 * detail and launch report wf-renamefastq as unavailable) or `?mockUnavailable=launch` (only the
 * launch answers `503`). Mock-only; read from the page URL at request time.
 */
function mockUnavailableMode(): 'all' | 'launch' | null {
  const value = new URLSearchParams(window.location.search).get('mockUnavailable');

  return value === '1' ? 'all' : value === 'launch' ? 'launch' : null;
}

function toPipelineDetail(pipeline: PipelineFixture): PipelineDetail {
  const unavailable = pipeline.executor === 'nextflow' && mockUnavailableMode() === 'all';

  return {
    ...pipeline,
    available: unavailable ? false : pipeline.available,
    unavailableReason: unavailable ? 'NEXTFLOW_DISABLED' : pipeline.unavailableReason,
    options: pipeline.options.map((option) =>
      option.type === 'enum' && option.key === 'kitName'
        ? { ...option, values: [...RENAMEFASTQ_KIT_NAMES] }
        : option,
    ),
    limits: pipeline.executor === 'nextflow' ? NEXTFLOW_LIMITS : null,
  };
}

function toPipelineSummary(pipeline: PipelineFixture): PipelineSummary {
  const { available, description, executor, id, inputLayouts, name, unavailableReason, version } =
    toPipelineDetail(pipeline);

  return { available, description, executor, id, inputLayouts, name, unavailableReason, version };
}

async function routePipelines(
  method: string,
  url: URL,
  body: unknown,
  idempotencyKey: string | undefined,
  onUploadProgress: UploadProgressHandler | undefined,
): Promise<TransportResponse> {
  const denied = requireSession();

  if (denied) {
    return denied;
  }

  advanceAll();

  const [, , pipelineId, action, extra] = url.pathname.split('/');

  if (method === 'GET' && pipelineId === undefined) {
    return ok({ items: pipelines.map(toPipelineSummary) });
  }

  const pipeline = pipelines.find((candidate) => candidate.id === pipelineId);

  if (!pipeline || extra !== undefined) {
    return fail(404, 'NOT_FOUND', 'This pipeline is not in the catalog.');
  }

  if (method === 'GET' && action === undefined) {
    return ok(toPipelineDetail(pipeline));
  }

  if (method === 'POST' && action === 'runs' && pipeline.executor === 'nextflow') {
    return launchRun(pipeline, body, idempotencyKey ?? crypto.randomUUID(), onUploadProgress);
  }

  return fail(404, 'NOT_FOUND', 'This pipeline is not in the catalog.');
}

type IssueDetail = { field: string; message: string };

async function launchRun(
  pipeline: PipelineFixture,
  body: unknown,
  key: string,
  onUploadProgress: UploadProgressHandler | undefined,
): Promise<TransportResponse> {
  const existing = replay(key);

  if (existing) {
    return existing;
  }

  // Like the API, availability is checked before any file is received.
  if (!toPipelineDetail(pipeline).available || mockUnavailableMode() === 'launch') {
    return fail(503, 'SERVICE_UNAVAILABLE', 'This pipeline is not available right now.');
  }

  if (!(body instanceof FormData)) {
    return fail(400, 'VALIDATION_FAILED', 'Request validation failed.', [
      { field: 'files', message: 'Send the run as multipart form data.' },
    ]);
  }

  await simulateUploadProgress(body, onUploadProgress);

  const result = await validateLaunch(body);

  if ('details' in result) {
    return fail(400, 'VALIDATION_FAILED', 'Request validation failed.', result.details);
  }

  const now = Date.now();
  const id = newMockJobId();
  const { fastq, layout, options, runName, sampleName, sheetSize } = result;
  const job: MockJob = {
    ...queuedTimestamps(id, now),
    file: null,
    outputs: null,
    parameters: null,
    pipelineId: pipeline.id as PipelineId,
    pipelineName: pipeline.name,
    progress: null,
    queuePosition: null,
    run: {
      // Same order as the API: FASTQ files by path, then the sample sheet.
      files: [
        ...fastq
          .map((file) => ({
            kind: 'FASTQ' as const,
            relativePath: file.name,
            sizeBytes: file.size,
          }))
          .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
        ...(sheetSize === null
          ? []
          : [
              {
                kind: 'SAMPLE_SHEET' as const,
                relativePath: 'sample_sheet.csv',
                sizeBytes: sheetSize,
              },
            ]),
      ],
      layout,
      options,
      sampleName,
    },
    runName,
    sampleLabel: runName,
    mockCreatedAtMs: now,
    // Illustrative step names only (taken from the design's examples).
    mockSteps: options.demultiplex ? ['DORADO_DEMULTIPLEX', 'FASTCAT'] : ['FASTCAT'],
  };

  return accept(job, key);
}

type ValidLaunch = {
  runName: string;
  layout: RunInputLayout;
  sampleName: string | null;
  options: RenamefastqOptions;
  fastq: File[];
  sheetSize: number | null;
};

/** Lightweight mirror of the API's C4 checks using the shared rules (never reads FASTQ data). */
async function validateLaunch(form: FormData): Promise<ValidLaunch | { details: IssueDetail[] }> {
  const details: IssueDetail[] = [];
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const runName = normalizeRunName(text('runName'));
  const layout = RUN_INPUT_LAYOUTS.find((candidate) => candidate === text('layout'));
  const sampleName = text('sampleName').trim() || null;
  const options = parseOptions(text('options'));
  const fastq = form.getAll('fastq').filter((value): value is File => value instanceof File);
  const sheetValue = form.get('sampleSheet');
  const sheet = sheetValue instanceof File ? sheetValue : null;

  if (!runName) {
    details.push({ field: 'runName', message: 'Enter a valid run name.' });
  }

  if (!layout) {
    details.push({ field: 'layout', message: 'Choose an input type.' });
  }

  if (!options) {
    details.push({ field: 'options', message: 'The options are not valid.' });
  }

  if (sampleName && !isValidSampleName(sampleName)) {
    details.push({ field: 'sampleName', message: 'The sample name is not valid.' });
  }

  if (fastq.length > RUN_INPUT_MAX_FASTQ_FILES) {
    details.push({ field: 'files', message: 'Upload at most 10 FASTQ files.' });
  }

  if (fastq.reduce((sum, file) => sum + file.size, 0) > RUN_INPUT_MAX_BYTES) {
    details.push({ field: 'files', message: 'The files must be 1 GB or smaller in total.' });
  }

  const classification = layout
    ? classifyLayoutAs(
        layout,
        fastq.map((file) => file.name),
      )
    : null;

  if (classification && !classification.ok) {
    details.push({ field: 'files', message: classification.message });
  }

  if (layout && options) {
    for (const issue of checkLaunchRules({
      demultiplex: options.demultiplex,
      hasSampleSheet: sheet !== null,
      layout,
      sampleName,
    })) {
      details.push({ field: issue.field, message: issue.message });
    }
  }

  if (sheet && layout === 'BARCODE_FOLDERS') {
    const parsed = parseSampleSheet(await sheet.text());

    if (!parsed.ok) {
      for (const issue of parsed.issues) {
        details.push({
          field: issue.line ? `sampleSheet.line ${issue.line}` : 'sampleSheet',
          message: issue.message,
        });
      }
    } else if (classification?.ok) {
      const match = matchSheetToFolders(
        parsed.rows.map((row) => row.barcode),
        classification.barcodes,
      );

      if (!match.ok) {
        details.push({
          field: 'sampleSheet',
          message: 'The barcodes in the sample sheet must match the barcode folders exactly.',
        });
      }
    }
  }

  if (details.length > 0 || !runName || !layout || !options) {
    return { details };
  }

  return { fastq, layout, options, runName, sampleName, sheetSize: sheet?.size ?? null };
}

function parseOptions(value: string): RenamefastqOptions | null {
  try {
    const raw = (value ? JSON.parse(value) : {}) as Partial<
      Record<keyof RenamefastqOptions, unknown>
    >;
    const options: RenamefastqOptions = {
      demultiplex: raw.demultiplex ?? false,
      kitName: raw.kitName ?? RENAMEFASTQ_DEFAULT_KIT_NAME,
      qualityFilter: raw.qualityFilter ?? true,
      qScore: raw.qScore ?? RENAMEFASTQ_DEFAULT_Q_SCORE,
    } as RenamefastqOptions;
    const valid =
      typeof options.demultiplex === 'boolean' &&
      typeof options.qualityFilter === 'boolean' &&
      (RENAMEFASTQ_KIT_NAMES as readonly string[]).includes(options.kitName) &&
      Number.isInteger(options.qScore) &&
      options.qScore >= RENAMEFASTQ_Q_SCORE_MIN &&
      options.qScore <= RENAMEFASTQ_Q_SCORE_MAX;

    return valid ? options : null;
  } catch {
    return null;
  }
}

// ---------- Identity & audit ----------

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
