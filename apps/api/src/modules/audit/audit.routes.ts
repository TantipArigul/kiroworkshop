import { Router } from 'express';

import {
  auditEventQuerySchema,
  createSuccessResponse,
  type AuditEvent,
  type AuditEventQuery,
} from '@portal/shared';

import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { redactAuditMetadata } from '../../shared/audit.js';
import { validationError } from '../identity/identity.routes.js';
import { getRequestId, type SessionGuard } from '../identity/session-guard.js';
import type { AuditService } from './audit.service.js';

type AuditRouterOptions = {
  prisma: Pick<PrismaClient, 'auditEvent'>;
  audit: AuditService;
  guard: SessionGuard;
};

const FILTER_KEYS = ['from', 'to', 'eventType', 'outcome', 'actorId', 'resourceType'] as const;

/** `GET /api/v1/audit-events` — read-only, newest first, requires `AUDIT_READ` (D3-9). */
export function createAuditRouter({ audit, guard, prisma }: AuditRouterOptions): Router {
  const router = Router();

  router.get(
    '/',
    guard.requireAuthenticated,
    guard.passwordChangeGate,
    guard.requirePermission('AUDIT_READ'),
    async (request, response, next) => {
      try {
        const query = auditEventQuerySchema.safeParse(request.query);

        if (!query.success) {
          throw validationError(query.error);
        }

        const { limit, page } = query.data;
        const where = buildWhere(query.data);
        const [total, rows] = await Promise.all([
          prisma.auditEvent.count({ where }),
          prisma.auditEvent.findMany({
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
            where,
          }),
        ]);

        await audit.recordSafely({
          actorId: request.actor?.userId ?? null,
          eventType: 'AUDIT_QUERIED',
          metadata: { filters: FILTER_KEYS.filter((key) => query.data[key] !== undefined), page },
          outcome: 'SUCCESS',
          requestId: getRequestId(response),
          resourceId: null,
          resourceType: 'AUDIT',
        });

        response
          .status(200)
          .json(
            createSuccessResponse(
              { items: rows.map(toAuditEvent), limit, page, total },
              getRequestId(response),
            ),
          );
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

function buildWhere(query: AuditEventQuery): Prisma.AuditEventWhereInput {
  return {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.eventType ? { eventType: query.eventType } : {}),
    ...(query.outcome ? { outcome: query.outcome } : {}),
    ...(query.resourceType ? { resourceType: query.resourceType } : {}),
    ...(query.from || query.to
      ? {
          occurredAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };
}

type AuditRow = Awaited<ReturnType<PrismaClient['auditEvent']['findMany']>>[number];

function toAuditEvent(row: AuditRow): AuditEvent {
  return {
    actorId: row.actorId,
    eventType: row.eventType as AuditEvent['eventType'],
    id: row.id,
    // Redact again on read as defence in depth for rows written before a pattern change.
    metadata: redactAuditMetadata(parseMetadata(row.metadataJson)) as Record<string, unknown>,
    occurredAt: row.occurredAt.toISOString(),
    outcome: row.outcome as AuditEvent['outcome'],
    requestId: row.requestId,
    resourceId: row.resourceId,
    resourceType: row.resourceType as AuditEvent['resourceType'],
  };
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
