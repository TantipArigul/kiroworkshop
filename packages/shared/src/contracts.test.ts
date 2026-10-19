import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ACTIVE_JOB_STATUSES,
  INPUT_FILE_MAX_BYTES,
  JOB_STATUSES,
  NO_MOCK_RECOMMENDATION_RULE_ID,
  RESULT_ARTIFACT_KINDS,
  TRAINING_BANDS,
  artifactIdSchema,
  jobResultSchema,
  nextflowResultSchema,
  recommendationSchema,
  resultArtifactCategorySchema,
  resultArtifactSchema,
  resultReferenceSchema,
  smartCheckupResultSchema,
  trainingBandSchema,
  RENAMEFASTQ_KIT_NAMES,
  RUN_INPUT_MAX_BYTES,
  TERMINAL_JOB_STATUSES,
  jobCancelResponseSchema,
  jobDetailSchema,
  jobProgressSchema,
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
import { jobStatusGenerator } from './testing/generators.js';

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

describe('result contracts', () => {
  const artifact = {
    id: 'cmgq1z3b40000abcd1234efgh',
    kind: 'RESULT',
    category: 'RESULT',
    displayName: 'smart-checkup-result-1234efgh.json',
    sizeBytes: 512,
    contentType: 'application/json',
    viewable: false,
    viewNote: null,
  };
  const references = [
    { label: 'Guide: reading your result', href: '/help#results' },
    { label: 'Nextflow documentation', href: 'https://www.nextflow.io/docs/latest/' },
  ];
  const smartCheckup = {
    pipelineId: 'smart-checkup',
    summary: {
      runName: 'Training sample A',
      focusArea: 'LIVER',
      ageBand: '40-49',
      lifestyleFactors: ['HIGH_ALCOHOL'],
      markerCount: 1,
      generatedAt: '2026-10-18T01:00:00.000Z',
    },
    markers: [
      {
        marker: 'alt',
        value: 300,
        unit: 'U/L',
        min: 5,
        max: 500,
        midpoint: 252.5,
        band: 'AT_OR_ABOVE_TRAINING_MIDPOINT',
      },
    ],
    recommendation: {
      ruleId: 'MOCK-LIVER-01',
      ruleVersion: 'mock-rules-2026.10-1',
      packageLabel: 'Training Package C — Liver',
      reason: 'Focus area LIVER and alt at or above the training midpoint.',
      matchedFactors: ['focusArea:LIVER', 'marker:alt'],
      matched: true,
      disclaimer: 'Training output only. Not a medical diagnosis or treatment advice.',
    },
    artifacts: [artifact],
    references,
  };
  const nextflow = {
    pipelineId: 'wf-renamefastq',
    summary: {
      runName: 'Run A',
      sampleCount: 1,
      totalReads: 1200,
      totalBases: 1_500_000,
      outputFileCount: 2,
      outputBytes: 4096,
    },
    samples: [
      {
        sample: 'sample_01',
        numSeqs: 1200,
        sumLen: 1_500_000,
        minLen: 200,
        avgLen: 1250.5,
        maxLen: 4000,
        avgQual: 17.2,
      },
    ],
    artifacts: [
      {
        ...artifact,
        kind: 'OUTPUT',
        category: 'REPORT',
        displayName: 'pipeline_info/execution_report_2026.html',
        contentType: 'text/html',
        viewable: true,
      },
      {
        ...artifact,
        id: 'cmgq1z3b40000abcd1234efgi',
        kind: 'OUTPUT',
        category: 'REPORT',
        displayName: 'pipeline_info/pipeline_dag_2026.html',
        contentType: 'text/html',
        viewNote: 'This report loads scripts from the internet, so it can only be downloaded.',
      },
    ],
    references,
  };

  it('exposes dependency-free result constants and the GONE error code', () => {
    expect(RESULT_ARTIFACT_KINDS).toEqual(['RESULT', 'OUTPUT']);
    expect(TRAINING_BANDS).toEqual(['BELOW_TRAINING_MIDPOINT', 'AT_OR_ABOVE_TRAINING_MIDPOINT']);
    expect(NO_MOCK_RECOMMENDATION_RULE_ID).toBe('NO_MATCH');
    expect(errorCodeSchema.safeParse('GONE').success).toBe(true);
  });

  it('discriminates the job result by pipeline and keeps every shape strict', () => {
    expect(jobResultSchema.parse(smartCheckup).pipelineId).toBe('smart-checkup');
    expect(jobResultSchema.parse(nextflow).pipelineId).toBe('wf-renamefastq');
    expect(jobResultSchema.safeParse({ ...smartCheckup, pipelineId: 'other' }).success).toBe(false);
    expect(jobResultSchema.safeParse({ ...nextflow, pipelineId: 'smart-checkup' }).success).toBe(
      false,
    );
    expect(smartCheckupResultSchema.safeParse({ ...smartCheckup, storagePath: '/x' }).success).toBe(
      false,
    );
    expect(
      nextflowResultSchema.safeParse({
        ...nextflow,
        summary: { ...nextflow.summary, outputDirectory: '/x' },
      }).success,
    ).toBe(false);
    expect(resultArtifactSchema.safeParse({ ...artifact, absolutePath: '/x' }).success).toBe(false);
    expect(resultArtifactSchema.safeParse({ ...artifact, id: '../etc' }).success).toBe(false);
  });

  it('keeps NO_MATCH the only unmatched recommendation and without matched factors', () => {
    const noMatch = {
      ...smartCheckup.recommendation,
      ruleId: 'NO_MATCH',
      packageLabel: 'No mock recommendation',
      matchedFactors: [],
      matched: false,
    };

    expect(
      smartCheckupResultSchema.safeParse({ ...smartCheckup, recommendation: noMatch }).success,
    ).toBe(true);
    expect(
      smartCheckupResultSchema.safeParse({
        ...smartCheckup,
        recommendation: { ...noMatch, matchedFactors: ['marker:alt'] },
      }).success,
    ).toBe(false);
    expect(
      smartCheckupResultSchema.safeParse({
        ...smartCheckup,
        recommendation: { ...smartCheckup.recommendation, matched: false },
      }).success,
    ).toBe(false);
  });

  it('rejects unsafe references, bands and non-finite statistics', () => {
    for (const href of ['//evil.test', 'javascript:alert(1)', 'http://example.test']) {
      expect(
        smartCheckupResultSchema.safeParse({
          ...smartCheckup,
          references: [{ label: 'x', href }],
        }).success,
      ).toBe(false);
    }

    expect(
      smartCheckupResultSchema.safeParse({
        ...smartCheckup,
        markers: [{ ...smartCheckup.markers[0], band: 'HIGH' }],
      }).success,
    ).toBe(false);
    expect(
      nextflowResultSchema.safeParse({
        ...nextflow,
        samples: [{ ...nextflow.samples[0], avgQual: Number.NaN }],
      }).success,
    ).toBe(false);
    expect(
      nextflowResultSchema.safeParse({
        ...nextflow,
        samples: [{ ...nextflow.samples[0], numSeqs: -1 }],
      }).success,
    ).toBe(false);
  });
});

describe('result contract building blocks (Results & Guidance C1)', () => {
  const recommendation = {
    ruleId: 'MOCK-GENERAL-01',
    ruleVersion: 'mock-rules-2026.10-1',
    packageLabel: 'Training Package A — General',
    reason: 'Focus area is General.',
    matchedFactors: ['focusArea:GENERAL'],
    matched: true,
    disclaimer: 'Training output only. Not a medical diagnosis or treatment advice.',
  };
  const artifact = {
    id: 'cmgq1z3b40000abcd1234efgh',
    kind: 'OUTPUT',
    category: 'STATS',
    displayName: 'stats/all_fastq_statistics.tsv',
    sizeBytes: 0,
    contentType: 'text/tab-separated-values',
    viewable: false,
    viewNote: null,
  };

  it('accepts only cuid-like artifact identifiers', () => {
    for (const id of ['cmgq1z3b40000abcd1234efgh', 'a'.repeat(20), 'a'.repeat(40)]) {
      expect(artifactIdSchema.safeParse(id).success).toBe(true);
    }
    for (const id of ['', 'a'.repeat(19), 'a'.repeat(41), 'CMGQ1Z3B40000ABCD1234EFGH', '../x']) {
      expect(artifactIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it('limits categories, bands and artifact fields', () => {
    expect(resultArtifactCategorySchema.options).toEqual([
      'RESULT',
      'READS',
      'STATS',
      'REPORT',
      'OTHER',
    ]);
    expect(trainingBandSchema.safeParse('BELOW_TRAINING_MIDPOINT').success).toBe(true);
    expect(trainingBandSchema.safeParse('LOW').success).toBe(false);
    expect(resultArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(resultArtifactSchema.safeParse({ ...artifact, kind: 'INPUT' }).success).toBe(false);
    expect(resultArtifactSchema.safeParse({ ...artifact, viewNote: '' }).success).toBe(false);
    expect(resultArtifactSchema.safeParse({ ...artifact, sizeBytes: -1 }).success).toBe(false);
    expect(resultArtifactSchema.safeParse({ ...artifact, sizeBytes: 1.5 }).success).toBe(false);
    expect(resultArtifactSchema.safeParse({ ...artifact, displayName: '' }).success).toBe(false);
  });

  it('accepts in-app paths and https links only as references', () => {
    for (const href of ['/help#results', '/license', 'https://www.nextflow.io/docs/latest/']) {
      expect(resultReferenceSchema.safeParse({ label: 'x', href }).success).toBe(true);
    }
    for (const href of [
      '',
      'help',
      '//cdn.test/x',
      'https://',
      'https://a b',
      'ftp://x.test',
      'data:text/html,x',
    ]) {
      expect(resultReferenceSchema.safeParse({ label: 'x', href }).success).toBe(false);
    }
    expect(resultReferenceSchema.safeParse({ label: '', href: '/help' }).success).toBe(false);
  });

  it('constrains rule ids and matched factor identifiers', () => {
    expect(recommendationSchema.safeParse(recommendation).success).toBe(true);
    for (const factor of ['marker:alt', 'lifestyle:HIGH_ALCOHOL', 'focusArea:LIVER']) {
      expect(
        recommendationSchema.safeParse({ ...recommendation, matchedFactors: [factor] }).success,
      ).toBe(true);
    }
    for (const factor of ['age:40-49', 'marker:', 'marker:a b', 'marker:<script>', 'alt']) {
      expect(
        recommendationSchema.safeParse({ ...recommendation, matchedFactors: [factor] }).success,
      ).toBe(false);
    }
    expect(recommendationSchema.safeParse({ ...recommendation, ruleId: 'mock rule' }).success).toBe(
      false,
    );
    expect(recommendationSchema.safeParse({ ...recommendation, extra: true }).success).toBe(false);
  });

  it('caps per-sample rows and listed artifacts at 1000', () => {
    const sample = {
      sample: 's',
      numSeqs: 1,
      sumLen: 1,
      minLen: 1,
      avgLen: 1,
      maxLen: 1,
      avgQual: 1,
    };
    const nextflow = {
      pipelineId: 'wf-renamefastq',
      summary: {
        runName: '',
        sampleCount: 0,
        totalReads: 0,
        totalBases: 0,
        outputFileCount: 0,
        outputBytes: 0,
      },
      samples: [],
      artifacts: [],
      references: [],
    };
    expect(nextflowResultSchema.safeParse(nextflow).success).toBe(true);
    expect(
      nextflowResultSchema.safeParse({ ...nextflow, samples: Array(1000).fill(sample) }).success,
    ).toBe(true);
    expect(
      nextflowResultSchema.safeParse({ ...nextflow, samples: Array(1001).fill(sample) }).success,
    ).toBe(false);
    expect(
      nextflowResultSchema.safeParse({ ...nextflow, artifacts: Array(1001).fill(artifact) })
        .success,
    ).toBe(false);
  });
});
