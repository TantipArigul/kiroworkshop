import {
  auditEventTypeSchema,
  auditOutcomeSchema,
  auditResourceTypeSchema,
  type AuditEventType,
  type AuditOutcome,
  type AuditResourceType,
} from '@portal/shared';
import { z } from 'zod';

import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { redactAuditMetadata } from '../../shared/audit.js';

type AuditWriter = Pick<PrismaClient, 'auditEvent'> | Prisma.TransactionClient;
type AuditLogger = { error: (object: Record<string, unknown>, message: string) => void };

export type AuditRecordInput = {
  eventType: AuditEventType;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  /** Internal user ID only — never an e-mail address (NFR-005). `null` for CLI/system events. */
  actorId?: string | null;
  outcome: AuditOutcome;
  requestId: string;
  metadata?: Record<string, unknown>;
};

const METADATA_MAX_BYTES = 2048;

/**
 * Metadata keys each event type may store. Anything else is dropped before redaction so
 * callers cannot accidentally persist input content or personal data.
 */
const METADATA_ALLOWLIST: Readonly<Record<AuditEventType, readonly string[]>> = {
  LOGIN_SUCCESS: [],
  LOGIN_FAILURE: ['reason'],
  ACCOUNT_LOCKED: ['lockMinutes'],
  LOGOUT: [],
  AUTHORIZATION_DENIED: ['permission', 'method', 'route'],
  PASSWORD_CHANGED: ['otherSessionsRevoked'],
  PASSWORD_RESET: ['channel', 'sessionsRevoked'],
  USER_CREATED: ['channel', 'role'],
  USER_DISABLED: ['channel', 'sessionsRevoked'],
  USER_ENABLED: ['channel'],
  USER_ROLE_CHANGED: ['channel', 'from', 'to', 'sessionsRevoked'],
  USER_ANONYMIZED: ['channel', 'sessionsRevoked'],
  AUDIT_QUERIED: ['filters', 'page'],
  AUDIT_RETENTION_CLEANUP: ['channel', 'deleted', 'retentionDays'],
  JOB_SUBMITTED: ['status'],
  JOB_STATUS_CHANGED: ['from', 'to'],
  JOB_DELETED: ['reason'],
  RESULT_DOWNLOADED: ['artifactId'],
};

const recordInputSchema = z.object({
  eventType: auditEventTypeSchema,
  resourceType: auditResourceTypeSchema,
  resourceId: z.string().min(1).max(128).nullable().optional(),
  actorId: z.string().min(1).max(128).nullable().optional(),
  outcome: auditOutcomeSchema,
  requestId: z.string().min(1).max(128),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AuditService = ReturnType<typeof createAuditService>;

export function createAuditService(prisma: Pick<PrismaClient, 'auditEvent'>, logger: AuditLogger) {
  /**
   * Writes one audit event. Pass the Prisma transaction client when the event belongs to a
   * state change so a failed audit write rolls the change back (D3-8).
   */
  async function record(input: AuditRecordInput, writer: AuditWriter = prisma): Promise<string> {
    const event = recordInputSchema.parse(input);
    const metadataJson = serializeMetadata(event.eventType, event.metadata ?? {});
    const created = await writer.auditEvent.create({
      data: {
        actorId: event.actorId ?? null,
        eventType: event.eventType,
        metadataJson,
        outcome: event.outcome,
        requestId: event.requestId,
        resourceId: event.resourceId ?? null,
        resourceType: event.resourceType,
      },
      select: { id: true },
    });

    return created.id;
  }

  /** For events without a state change (e.g. a denial): a failed write is logged, not thrown. */
  async function recordSafely(input: AuditRecordInput): Promise<void> {
    try {
      await record(input);
    } catch (error) {
      logger.error(
        { err: error, eventType: input.eventType, requestId: input.requestId },
        'Failed to write audit event',
      );
    }
  }

  return { record, recordSafely };
}

function serializeMetadata(eventType: AuditEventType, metadata: Record<string, unknown>): string {
  const allowed = METADATA_ALLOWLIST[eventType];
  const filtered = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => allowed.includes(key)),
  );
  const json = JSON.stringify(redactAuditMetadata(filtered));

  return Buffer.byteLength(json, 'utf8') > METADATA_MAX_BYTES ? '{"truncated":true}' : json;
}
