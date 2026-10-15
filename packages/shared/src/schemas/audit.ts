import { z } from 'zod';

import { AUDIT_EVENT_TYPES, AUDIT_RESOURCE_TYPES } from '../constants.js';
import { apiMetaSchema, auditOutcomeSchema } from './common.js';

export { AUDIT_EVENT_TYPES, AUDIT_RESOURCE_TYPES };

const AUDIT_PAGE_SIZE_MAX = 100;
const IDENTIFIER_MAX_LENGTH = 128;

export const auditEventTypeSchema = z.enum(AUDIT_EVENT_TYPES);
export const auditResourceTypeSchema = z.enum(AUDIT_RESOURCE_TYPES);

const identifierSchema = z.string().min(1).max(IDENTIFIER_MAX_LENGTH);
// Inbound X-Request-ID values are preserved, so audit request IDs are not always UUIDs.
const auditRequestIdSchema = z.string().min(1).max(IDENTIFIER_MAX_LENGTH);

export const auditEventSchema = z
  .object({
    id: identifierSchema,
    occurredAt: z.iso.datetime({ offset: true }),
    actorId: identifierSchema.nullable(),
    eventType: auditEventTypeSchema,
    resourceType: auditResourceTypeSchema,
    resourceId: identifierSchema.nullable(),
    outcome: auditOutcomeSchema,
    requestId: auditRequestIdSchema,
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

export const auditEventQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    eventType: auditEventTypeSchema.optional(),
    outcome: auditOutcomeSchema.optional(),
    actorId: identifierSchema.optional(),
    resourceType: auditResourceTypeSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE_MAX).default(20),
  })
  .strict()
  .refine((query) => !query.from || !query.to || Date.parse(query.from) <= Date.parse(query.to), {
    message: 'Start time must not be after end time.',
    path: ['from'],
  });

export const auditEventListResponseSchema = z
  .object({
    data: z
      .object({
        items: z.array(auditEventSchema).max(AUDIT_PAGE_SIZE_MAX),
        page: z.number().int().min(1),
        limit: z.number().int().min(1).max(AUDIT_PAGE_SIZE_MAX),
        total: z.number().int().min(0),
      })
      .strict(),
    meta: apiMetaSchema,
  })
  .strict();
