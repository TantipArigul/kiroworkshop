import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  auditNotificationSchema,
  createSuccessResponse,
  healthResponseSchema,
  loginRequestSchema,
  paginationSchema,
} from './index.js';

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

  it('validates auth, health, pagination and audit contract shapes', () => {
    expect(
      loginRequestSchema.safeParse({ username: 'demo-user', password: 'password' }).success,
    ).toBe(true);
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
