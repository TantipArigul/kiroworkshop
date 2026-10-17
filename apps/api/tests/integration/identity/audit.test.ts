import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createAuditService,
  deleteExpiredAuditEvents,
} from '../../../src/modules/audit/audit.service.js';
import { createSession } from '../../support/http-session.js';
import {
  createIdentityTestContext,
  TEST_PASSWORD,
  type IdentityTestContext,
} from '../../support/identity-context.js';

let context: IdentityTestContext;
let auditor: ReturnType<typeof createSession>;
let user: ReturnType<typeof createSession>;
let userId: string;

beforeAll(async () => {
  context = await createIdentityTestContext();
  await context.createUser('auditor@example.test', 'AUDITOR', { ready: true });
  userId = (await context.createUser('member@example.test', 'USER', { ready: true })).id;
  auditor = createSession(context.url);
  user = createSession(context.url);
  await auditor.login('auditor@example.test', TEST_PASSWORD);
  await user.login('member@example.test', TEST_PASSWORD);
  await createSession(context.url).login('ghost@example.test', TEST_PASSWORD);
});

afterAll(async () => {
  await context.cleanup();
});

beforeEach(() => {
  expect.hasAssertions();
});

/**
 * Prisma reports a trigger `RAISE(ABORT, …)` as P2003 with a generic message; the trigger's own
 * text is kept in the driver adapter error metadata.
 */
async function triggerMessage(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return 'NO ERROR';
  } catch (error) {
    const meta = (
      error as { meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } } }
    ).meta;
    return meta?.driverAdapterError?.cause?.originalMessage ?? 'UNKNOWN ERROR';
  }
}

describe('GET /api/v1/audit-events (US-015, D3-9)', () => {
  it('denies users without AUDIT_READ and records AUTHORIZATION_DENIED', async () => {
    const response = await user.get('/api/v1/audit-events');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('AUTHORIZATION_DENIED');
    expect(
      await context.prisma.auditEvent.count({
        where: { actorId: userId, eventType: 'AUTHORIZATION_DENIED', outcome: 'DENIED' },
      }),
    ).toBe(1);
  });

  it('requires a session', async () => {
    expect((await createSession(context.url).get('/api/v1/audit-events')).status).toBe(401);
  });

  it('lists events newest first with redacted metadata and no e-mail addresses', async () => {
    const response = await auditor.get('/api/v1/audit-events?limit=100');

    expect(response.status).toBe(200);
    const { items, total } = response.body.data as {
      items: { eventType: string; occurredAt: string }[];
      total: number;
    };
    expect(total).toBe(items.length);
    expect(items.map((item) => item.eventType)).toEqual(
      expect.arrayContaining([
        'USER_CREATED',
        'LOGIN_SUCCESS',
        'LOGIN_FAILURE',
        'AUTHORIZATION_DENIED',
      ]),
    );
    expect(
      items.every((item, index) => index === 0 || items[index - 1]!.occurredAt >= item.occurredAt),
    ).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('@');
  });

  it('records AUDIT_QUERIED with the filter names used', async () => {
    await auditor.get('/api/v1/audit-events?outcome=FAILURE&page=1');

    const event = await context.prisma.auditEvent.findFirstOrThrow({
      orderBy: { occurredAt: 'desc' },
      where: { eventType: 'AUDIT_QUERIED' },
    });
    expect(JSON.parse(event.metadataJson)).toEqual({ filters: ['outcome'], page: 1 });
  });

  it('filters by outcome, event type, actor and time range', async () => {
    const failures = await auditor.get('/api/v1/audit-events?outcome=FAILURE');
    expect(failures.body.data.items.length).toBeGreaterThan(0);
    expect(
      failures.body.data.items.every((item: { outcome: string }) => item.outcome === 'FAILURE'),
    ).toBe(true);

    const byActor = await auditor.get(
      `/api/v1/audit-events?actorId=${userId}&eventType=LOGIN_SUCCESS`,
    );
    expect(byActor.body.data.items).toHaveLength(1);

    const future = new Date(Date.now() + 60_000).toISOString();
    const empty = await auditor.get(`/api/v1/audit-events?from=${encodeURIComponent(future)}`);
    expect(empty.body.data).toMatchObject({ items: [], total: 0 });
  });

  it('paginates with stable page metadata', async () => {
    const first = await auditor.get('/api/v1/audit-events?limit=2&page=1');
    const second = await auditor.get('/api/v1/audit-events?limit=2&page=2');

    expect(first.body.data).toMatchObject({ limit: 2, page: 1 });
    expect(first.body.data.items).toHaveLength(2);
    expect(second.body.data.items[0].id).not.toBe(first.body.data.items[0].id);
  });

  it.each([
    ['limit above 100', 'limit=101'],
    ['unknown filter', 'email=member@example.test'],
    ['start after end', 'from=2026-10-16T00:00:00.000Z&to=2026-10-15T00:00:00.000Z'],
    ['invalid outcome', 'outcome=MAYBE'],
  ])('rejects %s with 400', async (_label, query) => {
    const response = await auditor.get(`/api/v1/audit-events?${query}`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('AuditEvent append-only storage (US-015 AC4, D3-8/D3-10)', () => {
  it('rejects updates and deletes within the retention window', async () => {
    const event = await context.prisma.auditEvent.findFirstOrThrow();

    expect(
      await triggerMessage(
        context.prisma.auditEvent.update({
          data: { outcome: 'SUCCESS' },
          where: { id: event.id },
        }),
      ),
    ).toBe('AuditEvent is append-only');
    expect(
      await triggerMessage(context.prisma.auditEvent.delete({ where: { id: event.id } })),
    ).toBe('AuditEvent within retention cannot be deleted');
  });

  it('prevents deleting a user that audit rows reference (anonymize instead)', async () => {
    expect(await triggerMessage(context.prisma.user.delete({ where: { id: userId } }))).toBe(
      'AuditEvent is append-only',
    );
    expect(await context.prisma.user.count({ where: { id: userId } })).toBe(1);
  });

  it('retention cleanup deletes only events older than 90 days and records itself', async () => {
    await context.prisma.$executeRaw`
      INSERT INTO "AuditEvent" ("id", "occurredAt", "eventType", "resourceType", "outcome", "requestId", "metadataJson")
      VALUES ('old_iso', '2026-01-01T00:00:00.000+00:00', 'LOGIN_FAILURE', 'USER', 'FAILURE', 'r', '{}'),
             ('old_sqlite', '2026-01-02 00:00:00', 'LOGIN_FAILURE', 'USER', 'FAILURE', 'r', '{}')`;
    const before = await context.prisma.auditEvent.count();
    const audit = createAuditService(context.prisma, { error: () => undefined });

    const deleted = await deleteExpiredAuditEvents(context.prisma, audit, {
      requestId: 'test-cleanup',
      retentionDays: context.config.auditRetentionDays,
    });

    expect(deleted).toBe(2);
    expect(await context.prisma.auditEvent.count()).toBe(before - 2 + 1);
    expect(
      await context.prisma.auditEvent.count({ where: { eventType: 'AUDIT_RETENTION_CLEANUP' } }),
    ).toBe(1);
  });
});
