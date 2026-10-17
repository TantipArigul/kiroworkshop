import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ACTIVE_JOB_STATUSES,
  INPUT_FILE_MAX_BYTES,
  JOB_STATUSES,
  RENAMEFASTQ_KIT_NAMES,
  RUN_INPUT_MAX_BYTES,
  TERMINAL_JOB_STATUSES,
  jobCancelResponseSchema,
  jobDetailSchema,
  jobProgressSchema,
  jobStatusGenerator,
  jobStatusSchema,
  jobSummarySchema,
  pipelineDetailSchema,
  pipelineListSchema,
  pipelineSummarySchema,
  renamefastqOptionsSchema,
  runLaunchFieldsSchema,
  apiErrorSchema,
  auditEventListResponseSchema,
  auditEventQuerySchema,
  auditEventTypeSchema,
  auditNotificationSchema,
  authenticatedUserSchema,
  changePasswordRequestSchema,
  createSuccessResponse,
  healthResponseSchema,
  idempotencyKeySchema,
  jobIdSchema,
  jobParametersSchema,
  jobSubmitRequestSchema,
  loginRequestSchema,
  paginationSchema,
} from './index.js';
import { errorCodeSchema } from './schemas/index.js';

const requestId = '46d1f548-322b-41d6-b67f-3876622e1b63';

describe('shared API contracts', () => {
  it('creates a strict success envelope with request ID metadata', () => {
    expect(createSuccessResponse({ status: 'ok' }, requestId)).toEqual({
      data: { status: 'ok' },
      meta: { requestId },
    });
  });

  it('rejects unexpected or unsafe API error fields', () => {
    expect(
      apiErrorSchema.safeParse({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Unable to complete the request.',
          details: [],
          stack: 'secret-stack-trace',
        },
        meta: { requestId },
      }).success,
    ).toBe(false);
  });

  it('validates health, pagination and audit notification contract shapes', () => {
    expect(
      healthResponseSchema.safeParse({
        data: { status: 'ok', uptimeSeconds: 12, version: '0.1.0' },
        meta: { requestId },
      }).success,
    ).toBe(true);
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(
      auditNotificationSchema.safeParse({
        eventType: 'JOB_SUBMITTED',
        actorId: 'usr_demo',
        resourceType: 'JOB',
        resourceId: 'job_demo',
        outcome: 'SUCCESS',
        requestId,
        occurredAt: '2026-10-01T08:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('identity contracts', () => {
  it('normalizes the e-mail login identifier and rejects the legacy username field', () => {
    expect(
      loginRequestSchema.parse({ email: '  User@Example.TEST ', password: 'synthetic-pass' }),
    ).toEqual({ email: 'user@example.test', password: 'synthetic-pass' });
    expect(
      loginRequestSchema.safeParse({ username: 'demo-user', password: 'synthetic-pass' }).success,
    ).toBe(false);
    expect(loginRequestSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(
      false,
    );
  });

  it('bounds password input length without applying the server-side policy', () => {
    expect(
      changePasswordRequestSchema.safeParse({ currentPassword: 'a', newPassword: 'b' }).success,
    ).toBe(true);
    expect(
      changePasswordRequestSchema.safeParse({
        currentPassword: 'a',
        newPassword: 'x'.repeat(1025),
      }).success,
    ).toBe(false);
  });

  it('accepts the AUDITOR role and rejects unknown roles or permissions', () => {
    const user = {
      id: 'usr_demo',
      email: 'auditor@example.test',
      role: 'AUDITOR',
      permissions: ['AUDIT_READ'],
      passwordChangeRequired: false,
    };

    expect(authenticatedUserSchema.safeParse(user).success).toBe(true);
    expect(authenticatedUserSchema.safeParse({ ...user, role: 'ROOT' }).success).toBe(false);
    expect(
      authenticatedUserSchema.safeParse({ ...user, permissions: ['JOB_READ_ALL'] }).success,
    ).toBe(false);
    expect(authenticatedUserSchema.safeParse({ ...user, passwordHash: 'x' }).success).toBe(false);
  });

  it('includes the forced password change error code', () => {
    expect(errorCodeSchema.safeParse('PASSWORD_CHANGE_REQUIRED').success).toBe(true);
  });
});

describe('audit query contracts', () => {
  it('applies pagination defaults and enforces the maximum page size', () => {
    expect(auditEventQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(auditEventQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(auditEventQuerySchema.safeParse({ unknown: 'x' }).success).toBe(false);
  });

  it('rejects a time range whose start is after its end', () => {
    expect(
      auditEventQuerySchema.safeParse({
        from: '2026-10-15T00:00:00.000Z',
        to: '2026-10-14T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      auditEventQuerySchema.safeParse({
        from: '2026-10-14T00:00:00.000+00:00',
        to: '2026-10-15T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('validates a redacted audit event list without e-mail fields', () => {
    const response = {
      data: {
        items: [
          {
            id: 'aud_1',
            occurredAt: '2026-10-15T03:55:00.000+00:00',
            actorId: null,
            eventType: 'LOGIN_FAILURE',
            resourceType: 'USER',
            resourceId: null,
            outcome: 'FAILURE',
            requestId: 'client-supplied-request-id',
            metadata: { reason: 'UNKNOWN_ACCOUNT' },
          },
        ],
        page: 1,
        limit: 20,
        total: 1,
      },
      meta: { requestId },
    };

    expect(auditEventListResponseSchema.safeParse(response).success).toBe(true);
    expect(
      auditEventListResponseSchema.safeParse({
        ...response,
        data: {
          ...response.data,
          items: [{ ...response.data.items[0], email: 'user@example.test' }],
        },
      }).success,
    ).toBe(false);
  });
});

describe('job contracts', () => {
  const parameters = {
    sampleLabel: 'Training sample A',
    ageBand: '40-49',
    focusArea: 'CARDIOMETABOLIC',
    lifestyleFactors: ['LOW_ACTIVITY'],
  };

  it('applies defaults and rejects unknown or unsafe parameter values', () => {
    expect(
      jobSubmitRequestSchema.parse({ parameters, file: { name: 'a.csv', content: 'x' } }),
    ).toMatchObject({ parameters: { simulateFailure: false } });
    expect(jobParametersSchema.safeParse({ ...parameters, ageBand: '10-17' }).success).toBe(false);
    expect(jobParametersSchema.safeParse({ ...parameters, sampleLabel: '<script>' }).success).toBe(
      false,
    );
    expect(
      jobParametersSchema.safeParse({ ...parameters, lifestyleFactors: ['SMOKING', 'SMOKING'] })
        .success,
    ).toBe(false);
    expect(jobParametersSchema.safeParse({ ...parameters, patientName: 'x' }).success).toBe(false);
  });

  it('bounds the inline file and requires UUID idempotency keys and cuid job IDs', () => {
    expect(
      jobSubmitRequestSchema.safeParse({
        parameters,
        file: { name: 'a.csv', content: 'x'.repeat(INPUT_FILE_MAX_BYTES + 1) },
      }).success,
    ).toBe(false);
    expect(idempotencyKeySchema.safeParse('46d1f548-322b-41d6-b67f-3876622e1b63').success).toBe(
      true,
    );
    expect(idempotencyKeySchema.safeParse('retry-1').success).toBe(false);
    expect(jobIdSchema.safeParse('cmgq1z3b40000abcd1234efgh').success).toBe(true);
    expect(jobIdSchema.safeParse('../etc').success).toBe(false);
  });

  it('includes the job error code and audit event type added by the unit', () => {
    expect(errorCodeSchema.safeParse('SERVICE_UNAVAILABLE').success).toBe(true);
    expect(auditEventTypeSchema.safeParse('JOB_INPUT_REJECTED').success).toBe(true);
  });
});

describe('pipeline catalog contracts', () => {
  const summary = {
    id: 'cmgq1z3b40000abcd1234efgh',
    sampleLabel: 'Run A',
    pipelineId: 'wf-renamefastq',
    pipelineName: 'Rename FASTQ',
    runName: 'Run A',
    status: 'QUEUED',
    queuePosition: 1,
    progress: null,
    createdAt: '2026-10-18T01:00:00.000Z',
    updatedAt: '2026-10-18T01:00:00.000Z',
    expiresAt: '2026-10-25T01:00:00.000Z',
  };
  const options = { demultiplex: false, kitName: 'BiK-HLA114-96', qualityFilter: true, qScore: 14 };

  it('adds CANCELLED, terminal statuses and the CONFLICT error code', () => {
    expect(JOB_STATUSES).toContain('CANCELLED');
    expect(jobStatusSchema.safeParse('CANCELLED').success).toBe(true);
    expect(TERMINAL_JOB_STATUSES).toEqual(['COMPLETED', 'FAILED', 'CANCELLED']);
    expect(
      ACTIVE_JOB_STATUSES.some((status) => TERMINAL_JOB_STATUSES.includes(status as never)),
    ).toBe(false);
    expect(errorCodeSchema.safeParse('CONFLICT').success).toBe(true);
    fc.assert(
      fc.property(jobStatusGenerator, (status) => {
        expect(JOB_STATUSES).toContain(status);
      }),
    );
  });

  it('copies the 43 kit names of wf-renamefastq 1.0.3 with the pipeline default first', () => {
    expect(RENAMEFASTQ_KIT_NAMES).toHaveLength(43);
    expect(new Set(RENAMEFASTQ_KIT_NAMES).size).toBe(43);
    expect(RENAMEFASTQ_KIT_NAMES[0]).toBe('BiK-HLA114-96');
    expect(RUN_INPUT_MAX_BYTES).toBe(1_073_741_824);
  });

  it('applies option defaults and rejects unknown or out-of-range options', () => {
    expect(renamefastqOptionsSchema.parse({})).toEqual(options);
    expect(renamefastqOptionsSchema.safeParse({ qScore: 61 }).success).toBe(false);
    expect(renamefastqOptionsSchema.safeParse({ qScore: 1.5 }).success).toBe(false);
    expect(renamefastqOptionsSchema.safeParse({ kitName: 'UNKNOWN-KIT' }).success).toBe(false);
    expect(renamefastqOptionsSchema.safeParse({ outdir: '/tmp' }).success).toBe(false);
  });

  it('parses multipart launch fields', () => {
    expect(
      runLaunchFieldsSchema.parse({
        layout: 'SAMPLE_FOLDER',
        options: '{"demultiplex":true}',
        runName: '  Run A ',
        sampleName: '',
      }),
    ).toEqual({
      layout: 'SAMPLE_FOLDER',
      options: { ...options, demultiplex: true },
      runName: 'Run A',
    });
    expect(
      runLaunchFieldsSchema.parse({ layout: 'SINGLE_FILE', runName: 'r', sampleName: 's_1' }),
    ).toEqual({ layout: 'SINGLE_FILE', options, runName: 'r', sampleName: 's_1' });
    expect(
      runLaunchFieldsSchema.safeParse({ layout: 'SINGLE_FILE', options: 'not json', runName: 'r' })
        .success,
    ).toBe(false);
    expect(
      runLaunchFieldsSchema.safeParse({ layout: 'SINGLE_FILE', runName: 'r', sampleName: 'a b' })
        .success,
    ).toBe(false);
    expect(runLaunchFieldsSchema.safeParse({ layout: 'ZIP', runName: 'r' }).success).toBe(false);
    expect(
      runLaunchFieldsSchema.safeParse({ layout: 'SINGLE_FILE', runName: 'r', outdir: '/' }).success,
    ).toBe(false);
  });

  it('validates catalog summary and detail shapes', () => {
    const pipeline = {
      id: 'wf-renamefastq',
      name: 'Rename FASTQ',
      description: 'Renames and filters ONT FASTQ files.',
      version: '1.0.3',
      executor: 'nextflow',
      inputLayouts: ['SINGLE_FILE', 'SAMPLE_FOLDER', 'BARCODE_FOLDERS'],
      available: false,
      unavailableReason: 'DOCKER_UNAVAILABLE',
    };
    expect(pipelineListSchema.safeParse({ items: [pipeline] }).success).toBe(true);
    expect(pipelineSummarySchema.safeParse({ ...pipeline, id: 'other' }).success).toBe(false);
    expect(pipelineSummarySchema.safeParse({ ...pipeline, unavailableReason: 'x' }).success).toBe(
      false,
    );
    expect(
      pipelineDetailSchema.safeParse({
        ...pipeline,
        options: [
          {
            key: 'demultiplex',
            label: 'Demultiplex',
            description: '',
            type: 'boolean',
            default: false,
          },
          {
            key: 'kitName',
            label: 'Kit',
            description: '',
            type: 'enum',
            default: 'BiK-HLA114-96',
            values: [...RENAMEFASTQ_KIT_NAMES],
          },
          {
            key: 'qScore',
            label: 'Q',
            description: '',
            type: 'integer',
            default: 14,
            min: 0,
            max: 60,
          },
        ],
        limits: {
          maxFastqFiles: 10,
          maxTotalBytes: 1_073_741_824,
          sampleSheetMaxBytes: 65_536,
          fastqExtensions: ['.fastq', '.fq', '.fastq.gz', '.fq.gz'],
        },
      }).success,
    ).toBe(true);
    expect(
      pipelineDetailSchema.safeParse({
        ...pipeline,
        options: [{ key: 'x', label: 'X', description: '', type: 'string', default: '' }],
        limits: null,
      }).success,
    ).toBe(false);
  });

  it('extends job summary and detail for both pipelines', () => {
    expect(jobSummarySchema.safeParse(summary).success).toBe(true);
    expect(jobSummarySchema.safeParse({ ...summary, queuePosition: 0 }).success).toBe(false);
    expect(
      jobSummarySchema.safeParse({
        ...summary,
        progress: { completedSteps: 2, currentStep: 'FASTCAT (alias)', startedAt: null },
      }).success,
    ).toBe(false);
    expect(
      jobProgressSchema.safeParse({
        completedSteps: 2,
        currentStep: 'FASTCAT',
        startedAt: '2026-10-18T01:00:00.000Z',
      }).success,
    ).toBe(true);

    const detail = {
      ...summary,
      parameters: null,
      file: null,
      run: {
        layout: 'BARCODE_FOLDERS',
        sampleName: null,
        options,
        files: [
          { relativePath: 'fastq_pass/barcode01/r.fastq.gz', sizeBytes: 10, kind: 'FASTQ' },
          { relativePath: 'sample_sheet.csv', sizeBytes: 5, kind: 'SAMPLE_SHEET' },
        ],
      },
      outputs: null,
      cancellable: true,
      history: [],
      failureSummary: null,
      statusUrl: '/jobs/cmgq1z3b40000abcd1234efgh',
    };
    expect(jobDetailSchema.safeParse(detail).success).toBe(true);
    expect(jobDetailSchema.safeParse({ ...detail, cancellable: undefined }).success).toBe(false);
    expect(jobDetailSchema.safeParse({ ...detail, logPath: '/x' }).success).toBe(false);
    expect(
      jobCancelResponseSchema.safeParse({ job: { ...summary, status: 'CANCELLED' } }).success,
    ).toBe(true);
  });
});
