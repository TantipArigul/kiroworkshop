import { z } from 'zod';

import { AUDIT_OUTCOMES, JOB_STATUSES } from '../constants.js';

export const ERROR_CODES = [
  'AUTHENTICATION_FAILED',
  'AUTHENTICATION_REQUIRED',
  'AUTHORIZATION_DENIED',
  'CSRF_INVALID',
  'INTERNAL_ERROR',
  'NOT_FOUND',
  'NOT_IMPLEMENTED',
  'PASSWORD_CHANGE_REQUIRED',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'VALIDATION_FAILED',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export const requestIdSchema = z.string().uuid();
export const jobStatusSchema = z.enum(JOB_STATUSES);
export const auditOutcomeSchema = z.enum(AUDIT_OUTCOMES);

export const apiMetaSchema = z
  .object({
    requestId: requestIdSchema,
  })
  .strict();

export const apiErrorDetailSchema = z
  .object({
    field: z.string().min(1).max(128).optional(),
    message: z.string().min(1).max(256),
  })
  .strict();

export const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string().min(1).max(256),
        details: z.array(apiErrorDetailSchema).max(20),
      })
      .strict(),
    meta: apiMetaSchema,
  })
  .strict();

export const paginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const auditNotificationSchema = z
  .object({
    eventType: z.enum(['JOB_SUBMITTED', 'JOB_STATUS_CHANGED', 'JOB_DELETED', 'RESULT_DOWNLOADED']),
    actorId: z.string().min(1),
    resourceType: z.enum(['JOB', 'RESULT']),
    resourceId: z.string().min(1),
    outcome: auditOutcomeSchema,
    requestId: requestIdSchema,
    occurredAt: z.string().datetime(),
  })
  .strict();
