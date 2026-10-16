import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createSession, sessionCookieFrom } from '../../support/http-session.js';
import {
  createIdentityTestContext,
  OTHER_PASSWORD,
  TEST_PASSWORD,
  type IdentityTestContext,
} from '../../support/identity-context.js';

let context: IdentityTestContext;
let counter = 0;

/** Unique synthetic address per test so accounts never share lockout state. */
const nextEmail = () => `user${(counter += 1)}@example.test`;

beforeAll(async () => {
  context = await createIdentityTestContext();
});

afterAll(async () => {
  await context.cleanup();
});

beforeEach(() => {
  expect.hasAssertions();
});

describe('POST /api/v1/auth/login (US-001)', () => {
  it('signs in, regenerates the session ID and returns the public user only', async () => {
    const { email } = await context.createUser(nextEmail(), 'AUDITOR');
    const session = createSession(context.app);
    const csrfResponse = await session.agent.get('/api/v1/auth/csrf-token');
    const anonymousCookie = sessionCookieFrom(csrfResponse);
    await session.refreshCsrfToken();

    const response = await session.login(` ${email.toUpperCase()} `, TEST_PASSWORD);

    expect(response.status).toBe(200);
    expect(response.body.data.user).toEqual({
      email,
      id: expect.any(String),
      passwordChangeRequired: true,
      permissions: ['AUDIT_READ'],
      role: 'AUDITOR',
    });
    expect(response.body.data.csrfToken).toEqual(expect.any(String));
    expect(sessionCookieFrom(response)).not.toBeNull();
    expect(sessionCookieFrom(response)).not.toBe(anonymousCookie);
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|failedLogin|lockedUntil/);
  });

  it('returns the same response for unknown, wrong-password, disabled and locked accounts', async () => {
    const wrong = await context.createUser(nextEmail());
    const disabled = await context.createUser(nextEmail());
    const locked = await context.createUser(nextEmail());
    await context.prisma.user.update({
      data: { disabledAt: new Date() },
      where: { id: disabled.id },
    });
    await context.prisma.user.update({
      data: { lockedUntil: new Date(Date.now() + 60_000) },
      where: { id: locked.id },
    });

    const attempts = [
      ['ghost@example.test', TEST_PASSWORD],
      [wrong.email, OTHER_PASSWORD],
      [disabled.email, TEST_PASSWORD],
      [locked.email, TEST_PASSWORD],
    ] as const;
    const sessions = attempts.map(() => createSession(context.app));
    const responses = await Promise.all(
      attempts.map(([email, password], index) => sessions[index]!.login(email, password)),
    );

    for (const [index, response] of responses.entries()) {
      expect(response.status).toBe(401);
      expect(response.body.error).toEqual({
        code: 'AUTHENTICATION_FAILED',
        details: [],
        message: 'The e-mail address or password is incorrect.',
      });
      // A failed login re-sends the rolling anonymous cookie but never authenticates it.
      expect((await sessions[index]!.get('/api/v1/auth/me')).status).toBe(401);
    }
  });

  it('locks the account after 5 failures within the window, even for the right password', async () => {
    const { email, id } = await context.createUser(nextEmail());
    const session = createSession(context.app);

    for (let attempt = 0; attempt < context.config.loginLockoutThreshold; attempt += 1) {
      expect((await session.login(email, OTHER_PASSWORD)).status).toBe(401);
    }

    expect((await session.login(email, TEST_PASSWORD)).status).toBe(401);
    const user = await context.prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(
      await context.prisma.auditEvent.count({
        where: { eventType: 'ACCOUNT_LOCKED', resourceId: id },
      }),
    ).toBe(1);

    // After the lock expires, the correct password works and the counters reset.
    await context.prisma.user.update({
      data: { lockedUntil: new Date(Date.now() - 1) },
      where: { id },
    });
    expect((await session.login(email, TEST_PASSWORD)).status).toBe(200);
    expect(await context.prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({
      failedLoginCount: 0,
      lockedUntil: null,
    });
  });

  it('does not lock when failures fall outside the 15-minute window', async () => {
    const { email, id } = await context.createUser(nextEmail());
    const session = createSession(context.app);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await session.login(email, OTHER_PASSWORD);
    }

    await context.prisma.user.update({
      data: {
        failedLoginWindowStartedAt: new Date(Date.now() - context.config.loginLockoutWindowMs - 1),
      },
      where: { id },
    });
    await session.login(email, OTHER_PASSWORD);

    expect(await context.prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({
      failedLoginCount: 1,
      lockedUntil: null,
    });
  });

  it('rejects login, logout and password changes without a CSRF token', async () => {
    const { email } = await context.createUser(nextEmail(), 'USER', { ready: true });
    const session = createSession(context.app);
    await session.login(email, TEST_PASSWORD);

    for (const path of ['/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/auth/password']) {
      const response = await session.agent.post(path).send({});
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CSRF_INVALID');
    }
  });

  it('rejects malformed bodies with field details that never echo the input', async () => {
    const session = createSession(context.app);
    await session.refreshCsrfToken();

    const response = await session.post('/api/v1/auth/login', {
      email: 'not-an-email',
      password: 'leaky-secret-value',
      extra: true,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(response.body)).not.toContain('leaky-secret-value');
    expect(JSON.stringify(response.body)).not.toContain('not-an-email');
  });
});

describe('session lifecycle (US-001 AC3–AC4, D3-5)', () => {
  async function signedInSession() {
    const user = await context.createUser(nextEmail(), 'USER', { ready: true });
    const session = createSession(context.app);
    expect((await session.login(user.email, TEST_PASSWORD)).status).toBe(200);
    expect((await session.get('/api/v1/auth/me')).status).toBe(200);
    return { session, user };
  }

  it('rejects protected requests without a session', async () => {
    const response = await createSession(context.app).get('/api/v1/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('logout revokes the server-side session and records LOGOUT', async () => {
    const { session, user } = await signedInSession();

    expect((await session.post('/api/v1/auth/logout')).status).toBe(204);
    expect((await session.get('/api/v1/auth/me')).status).toBe(401);
    expect(
      await context.prisma.auditEvent.count({ where: { actorId: user.id, eventType: 'LOGOUT' } }),
    ).toBe(1);
  });

  it('expires idle sessions', async () => {
    const { session, user } = await signedInSession();
    await context.prisma.session.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
      where: { userId: user.id },
    });

    expect((await session.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('enforces the absolute 8-hour timeout even for an active session', async () => {
    const { session, user } = await signedInSession();
    const stored = await context.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    const data = JSON.parse(stored.dataJson) as Record<string, unknown>;
    data.authenticatedAt = Date.now() - context.config.sessionAbsoluteTimeoutMs - 1000;
    await context.prisma.session.update({
      data: { dataJson: JSON.stringify(data) },
      where: { id: stored.id },
    });

    expect((await session.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('signs out a user whose account is disabled mid-session', async () => {
    const { session, user } = await signedInSession();
    await context.identity.setDisabled({ disabled: true, email: user.email, requestId: 'test' });

    expect((await session.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('applies a role change on the next request', async () => {
    const { session, user } = await signedInSession();
    await context.prisma.user.update({ data: { role: 'AUDITOR' }, where: { id: user.id } });

    const response = await session.get('/api/v1/auth/me');
    expect(response.body.data.permissions).toEqual(['AUDIT_READ']);
  });
});

describe('POST /api/v1/auth/password (forced change, D3-2)', () => {
  it('blocks other routes until the password changes, then clears the flag', async () => {
    const { email } = await context.createUser(nextEmail(), 'AUDITOR');
    const session = createSession(context.app);
    await session.login(email, TEST_PASSWORD);

    const blocked = await session.get('/api/v1/audit-events');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await session.get('/api/v1/auth/me')).body.data.passwordChangeRequired).toBe(true);

    expect(
      (
        await session.post('/api/v1/auth/password', {
          currentPassword: TEST_PASSWORD,
          newPassword: OTHER_PASSWORD,
        })
      ).status,
    ).toBe(204);
    expect((await session.get('/api/v1/auth/me')).body.data.passwordChangeRequired).toBe(false);
    expect((await session.get('/api/v1/audit-events')).status).toBe(200);
  });

  it.each([
    ['too short', 'short', 'Use at least 12 characters.'],
    ['common password', 'password1234', 'This password is too common. Choose a different one.'],
    [
      'same as current',
      TEST_PASSWORD,
      'Choose a password that is different from your current one.',
    ],
  ])('rejects a %s new password with a field detail', async (_label, newPassword, message) => {
    const { email } = await context.createUser(nextEmail());
    const session = createSession(context.app);
    await session.login(email, TEST_PASSWORD);

    const response = await session.post('/api/v1/auth/password', {
      currentPassword: TEST_PASSWORD,
      newPassword,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details).toContainEqual({ field: 'newPassword', message });
  });

  it('rejects a wrong current password', async () => {
    const { email } = await context.createUser(nextEmail());
    const session = createSession(context.app);
    await session.login(email, TEST_PASSWORD);

    const response = await session.post('/api/v1/auth/password', {
      currentPassword: 'definitely-not-current-1',
      newPassword: OTHER_PASSWORD,
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_FAILED');
  });

  it('keeps the current session but signs out the user’s other sessions', async () => {
    const { email, id } = await context.createUser(nextEmail(), 'USER', { ready: true });
    const current = createSession(context.app);
    const other = createSession(context.app);
    await current.login(email, TEST_PASSWORD);
    await other.login(email, TEST_PASSWORD);

    await current.post('/api/v1/auth/password', {
      currentPassword: TEST_PASSWORD,
      newPassword: OTHER_PASSWORD,
    });

    expect((await current.get('/api/v1/auth/me')).status).toBe(200);
    expect((await other.get('/api/v1/auth/me')).status).toBe(401);
    const event = await context.prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'PASSWORD_CHANGED', resourceId: id },
    });
    expect(JSON.parse(event.metadataJson)).toEqual({ signedOutOtherCount: 1 });
  });
});
