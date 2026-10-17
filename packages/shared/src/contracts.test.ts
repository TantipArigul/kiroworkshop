import { describe, expect, it } from 'vitest';

import {
  INPUT_FILE_MAX_BYTES,
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
