import fc from 'fast-check';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PERMISSIONS, USER_ROLES } from '@portal/shared/constants';

import type { User } from '../../src/generated/prisma/client.js';
import { toAuthenticatedUser } from '../../src/modules/identity/identity.service.js';
import { permissionsForRole } from '../../src/modules/identity/permissions.js';
import { redactAuditMetadata } from '../../src/shared/audit.js';
import { canAccessOwnedResource } from '../../src/shared/authorization.js';
import { createSession } from '../support/http-session.js';
import {
  createIdentityTestContext,
  TEST_PASSWORD,
  type IdentityTestContext,
} from '../support/identity-context.js';

/** Identity-access correctness properties P1–P6 (design.md — Correctness Properties). */
const RUNS = { numRuns: 100 } as const;
const HTTP_TIMEOUT_MS = 180_000;

/** Expected least-privilege allowlist written independently of the implementation (D3-6). */
const ROLE_ALLOWLIST: Record<string, readonly string[]> = {
  ADMIN: ['AUDIT_READ', 'USER_MANAGE'],
  AUDITOR: ['AUDIT_READ'],
  USER: [],
};

const SYNTHETIC_USER = {
  email: 'synthetic@example.test',
  id: 'user_synthetic',
  passwordChangeRequired: false,
};

const roleArbitrary = fc.constantFrom(...USER_ROLES);
const distinctIdsArbitrary = fc
  .tuple(fc.uuid(), fc.uuid())
  .filter(([actorId, ownerId]) => actorId !== ownerId);

beforeEach(() => {
  expect.hasAssertions();
});

describe('P1 owner isolation (US-002 AC1–AC2)', () => {
  it('denies any non-owner that lacks the requested explicit permission', () => {
    fc.assert(
      fc.property(
        distinctIdsArbitrary,
        roleArbitrary,
        fc.array(fc.string({ maxLength: 24 }), { maxLength: 5 }),
        fc.option(fc.string({ maxLength: 24 }), { nil: undefined }),
        ([actorId, ownerId], role, explicitPermissions, requested) => {
          fc.pre(requested === undefined || !explicitPermissions.includes(requested));

          expect(
            canAccessOwnedResource(
              { explicitPermissions, permissions: permissionsForRole(role), role, userId: actorId },
              ownerId,
              requested,
            ),
          ).toBe(false);
        },
      ),
      RUNS,
    );
  });

  it('always allows the owner', () => {
    fc.assert(
      fc.property(fc.uuid(), roleArbitrary, (userId, role) => {
        expect(canAccessOwnedResource({ role, userId }, userId)).toBe(true);
      }),
      RUNS,
    );
  });
});

describe('P2 no implicit role access (US-002 AC3)', () => {
  it('role permissions never grant access to another user’s resource', () => {
    fc.assert(
      fc.property(
        distinctIdsArbitrary,
        roleArbitrary,
        fc.constantFrom(undefined, ...PERMISSIONS),
        ([actorId, ownerId], role, requested) => {
          const permissions = permissionsForRole(role);

          expect(
            canAccessOwnedResource({ permissions, role, userId: actorId }, ownerId, requested),
          ).toBe(false);
        },
      ),
      RUNS,
    );
  });
});

describe('P6 least-privilege permission map (US-002 AC3, US-015 AC3)', () => {
  it('grants each known role a subset of its allowlist and USER nothing', () => {
    fc.assert(
      fc.property(roleArbitrary, (role) => {
        const permissions = permissionsForRole(role);

        expect(permissions.every((permission) => ROLE_ALLOWLIST[role]!.includes(permission))).toBe(
          true,
        );
        expect(Object.isFrozen(permissions)).toBe(true);
        if (role === 'USER') {
          expect(permissions).toEqual([]);
        }
      }),
      RUNS,
    );
  });

  it('fails closed for any unknown role string, including case and whitespace variants', () => {
    const variantArbitrary = roleArbitrary.chain((role) =>
      fc.constantFrom(role.toLowerCase(), ` ${role}`, `${role} `, `${role}_`, `x${role}`),
    );

    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 16 }), variantArbitrary), (role) => {
        fc.pre(!(USER_ROLES as readonly string[]).includes(role));

        expect(permissionsForRole(role)).toEqual([]);
        expect(toAuthenticatedUser({ ...SYNTHETIC_USER, role } as User)).toMatchObject({
          permissions: [],
          role: 'USER',
        });
      }),
      RUNS,
    );
  });
});

describe('P5 recursive redaction (US-015 AC2, NFR-005)', () => {
  // Contains uppercase letters and a hyphen, so safe leaves generated below can never match it.
  const MARKER = 'S3CR3T-MARKER';
  const SENSITIVE_PATTERN =
    /authorization|cookie|csrf|email|password|path|secret|session|storage|token|username/i;
  const SENSITIVE_WORDS = [
    'authorization',
    'cookie',
    'csrf',
    'email',
    'password',
    'path',
    'secret',
    'session',
    'storage',
    'token',
    'username',
  ];
  const SAFE_KEYS = ['count', 'filters', 'id', 'limit', 'method', 'outcome', 'page', 'role'];

  const randomCase = (word: string) =>
    fc
      .array(fc.boolean(), { maxLength: word.length, minLength: word.length })
      .map((flags) =>
        [...word].map((char, index) => (flags[index] ? char.toUpperCase() : char)).join(''),
      );
  const sensitiveKey = fc
    .tuple(
      fc.constantFrom('', 'user', 'actor_', 'x-', 'new'),
      fc.constantFrom(...SENSITIVE_WORDS).chain(randomCase),
      fc.constantFrom('', 's', 'Hash', '_value', 'Id'),
    )
    .map((parts) => parts.join(''));
  const safeLeaf = fc.oneof(
    fc.stringMatching(/^[a-z0-9 ]{0,12}$/),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
  );
  const secretValue = fc.oneof(
    fc.constant(MARKER),
    fc.constant({ nested: MARKER }),
    fc.constant([MARKER, { inner: MARKER }]),
  );

  const { tree: mixedTree } = fc.letrec<{ tree: unknown; node: unknown }>((tie) => ({
    node: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      safeLeaf,
      fc.array(tie('node'), { maxLength: 3 }),
      tie('tree'),
    ),
    tree: fc
      .tuple(
        fc.dictionary(fc.constantFrom(...SAFE_KEYS), tie('node'), { maxKeys: 4 }),
        fc.dictionary(sensitiveKey, secretValue, { maxKeys: 3 }),
      )
      .map(([safe, sensitive]) => ({ ...safe, ...sensitive })),
  }));

  const { tree: safeTree } = fc.letrec<{ tree: unknown; node: unknown }>((tie) => ({
    node: fc.oneof(
      { depthSize: 'small' },
      safeLeaf,
      fc.array(tie('node'), { maxLength: 3 }),
      tie('tree'),
    ),
    tree: fc.dictionary(fc.constantFrom(...SAFE_KEYS), tie('node'), { maxKeys: 4 }),
  }));

  function sensitiveValuesAreRedacted(value: unknown): boolean {
    if (Array.isArray(value)) {
      return value.every(sensitiveValuesAreRedacted);
    }

    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).every(([key, nested]) =>
        SENSITIVE_PATTERN.test(key) ? nested === '[REDACTED]' : sensitiveValuesAreRedacted(nested),
      );
    }

    return true;
  }

  it('removes every sensitive value, including e-mail keys, at any depth', () => {
    fc.assert(
      fc.property(
        fc.array(mixedTree, { maxLength: 3 }).map((items) => ({ items, email: MARKER })),
        (metadata) => {
          const redacted = redactAuditMetadata(metadata);

          expect(JSON.stringify(redacted)).not.toContain(MARKER);
          expect(sensitiveValuesAreRedacted(redacted)).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it('leaves metadata without sensitive keys unchanged', () => {
    fc.assert(
      fc.property(safeTree, (metadata) => {
        expect(redactAuditMetadata(metadata)).toEqual(metadata);
      }),
      RUNS,
    );
  });
});

describe('HTTP properties (synthetic accounts, isolated test database)', () => {
  let context: IdentityTestContext;
  let accounts: Record<'wrong' | 'disabled' | 'locked' | 'active', { id: string; email: string }>;

  beforeAll(async () => {
    context = await createIdentityTestContext();
    accounts = {
      active: await context.createUser('active@example.test', 'AUDITOR', { ready: true }),
      disabled: await context.createUser('disabled@example.test', 'USER', { ready: true }),
      locked: await context.createUser('locked@example.test', 'USER', { ready: true }),
      wrong: await context.createUser('wrong@example.test', 'USER', { ready: true }),
    };
    await context.prisma.user.update({
      data: { disabledAt: new Date() },
      where: { id: accounts.disabled.id },
    });
  }, HTTP_TIMEOUT_MS);

  afterAll(async () => {
    await context?.cleanup();
  });

  it(
    'P3 every failed login returns the same status, code, message and body shape (US-001 AC2)',
    async () => {
      const reference = await createSession(context.app).login(
        'reference@example.test',
        TEST_PASSWORD,
      );
      expect(reference.status).toBe(401);
      const expectedError = reference.body.error;
      const expectedKeys = Object.keys(reference.body).sort();
      const expectedMetaKeys = Object.keys(reference.body.meta).sort();

      const passwordArbitrary = fc
        .string({ maxLength: 64, minLength: 1 })
        .filter((value) => value !== TEST_PASSWORD);
      const attemptArbitrary = fc.oneof(
        fc.record({
          kind: fc.constant('unknown' as const),
          local: fc.stringMatching(/^[a-z0-9]{1,20}$/),
          password: fc.oneof(fc.constant(TEST_PASSWORD), passwordArbitrary),
          upper: fc.boolean(),
        }),
        fc.record({
          kind: fc.constant('wrong' as const),
          local: fc.constant(''),
          password: passwordArbitrary,
          upper: fc.boolean(),
        }),
        fc.record({
          kind: fc.constantFrom('disabled' as const, 'locked' as const),
          local: fc.constant(''),
          password: fc.oneof(fc.constant(TEST_PASSWORD), passwordArbitrary),
          upper: fc.boolean(),
        }),
      );

      await fc.assert(
        fc.asyncProperty(attemptArbitrary, async ({ kind, local, password, upper }) => {
          const known = kind === 'unknown' ? null : accounts[kind];
          fc.pre(
            kind !== 'unknown' ||
              !Object.values(accounts).some((a) => a.email.startsWith(`${local}@`)),
          );
          const email = known?.email ?? `${local}@example.test`;

          // Keep each account in its intended state so the generated kind is what is tested.
          if (known) {
            await context.prisma.user.update({
              data: {
                failedLoginCount: 0,
                failedLoginWindowStartedAt: null,
                lockedUntil: kind === 'locked' ? new Date(Date.now() + 60_000) : null,
              },
              where: { id: known.id },
            });
          }

          const session = createSession(context.app);
          const response = await session.login(upper ? email.toUpperCase() : email, password);

          expect(response.status).toBe(401);
          expect(response.body.error).toEqual(expectedError);
          expect(Object.keys(response.body).sort()).toEqual(expectedKeys);
          expect(Object.keys(response.body.meta).sort()).toEqual(expectedMetaKeys);
          expect((await session.get('/api/v1/auth/me')).status).toBe(401);
        }),
        RUNS,
      );
    },
    HTTP_TIMEOUT_MS,
  );

  it(
    'P4 sessions after logout, revocation or timeout are rejected with 401 (US-001 AC3–AC4)',
    async () => {
      const { email, id } = accounts.active;
      const scenarioArbitrary = fc.record({
        endpoint: fc.constantFrom('/api/v1/auth/me', '/api/v1/audit-events'),
        kind: fc.constantFrom('logout', 'revoked', 'disabled', 'idle', 'absolute'),
        overrunMs: fc.integer({ max: 7 * 24 * 60 * 60 * 1000, min: 1 }),
      });

      await fc.assert(
        fc.asyncProperty(scenarioArbitrary, async ({ endpoint, kind, overrunMs }) => {
          await context.prisma.session.deleteMany({ where: { userId: id } });
          const session = createSession(context.app);
          expect((await session.login(email, TEST_PASSWORD)).status).toBe(200);
          expect((await session.get(endpoint)).status).toBe(200);

          try {
            if (kind === 'logout') {
              expect((await session.post('/api/v1/auth/logout')).status).toBe(204);
            } else if (kind === 'revoked') {
              // A role change (even to the same role) revokes every session of the account.
              await context.identity.setRole({ email, requestId: 'pbt', role: 'AUDITOR' });
            } else if (kind === 'disabled') {
              await context.identity.setDisabled({ disabled: true, email, requestId: 'pbt' });
            } else if (kind === 'idle') {
              await context.prisma.session.updateMany({
                data: { expiresAt: new Date(Date.now() - overrunMs) },
                where: { userId: id },
              });
            } else {
              const stored = await context.prisma.session.findFirstOrThrow({
                where: { userId: id },
              });
              const data = JSON.parse(stored.dataJson) as Record<string, unknown>;
              data.authenticatedAt =
                Date.now() - context.config.sessionAbsoluteTimeoutMs - overrunMs;
              await context.prisma.session.update({
                data: { dataJson: JSON.stringify(data) },
                where: { id: stored.id },
              });
            }

            const response = await session.get(endpoint);
            expect(response.status).toBe(401);
            expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
          } finally {
            if (kind === 'disabled') {
              await context.identity.setDisabled({ disabled: false, email, requestId: 'pbt' });
            }
          }
        }),
        RUNS,
      );
    },
    HTTP_TIMEOUT_MS,
  );
});
