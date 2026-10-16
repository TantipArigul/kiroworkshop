import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';
import { emailSchema, type AuthenticatedUser, type UserRole } from '@portal/shared';

import type { AppConfig } from '../../config/index.js';
import type { Prisma, PrismaClient, User } from '../../generated/prisma/client.js';
import type { AuditService } from '../audit/audit.service.js';
import { checkPassword, type PasswordViolation } from './password-policy.js';
import { isUserRole, permissionsForRole } from './permissions.js';

type IdentityConfig = Pick<
  AppConfig,
  'loginLockoutThreshold' | 'loginLockoutWindowMs' | 'loginLockoutDurationMs'
>;

type TransactionClient = Prisma.TransactionClient;

export type IdentityServiceOptions = {
  prisma: PrismaClient;
  audit: AuditService;
  config: IdentityConfig;
  /** Injectable for tests. */
  clock?: () => Date;
};

/** Same outcome for unknown, wrong-password, locked and disabled accounts (US-001 AC2). */
export class AuthenticationFailedError extends Error {
  public constructor() {
    super('The e-mail address or password is incorrect.');
    this.name = 'AuthenticationFailedError';
  }
}

export class PasswordPolicyError extends Error {
  public constructor(public readonly violations: readonly PasswordViolation[]) {
    super('The password does not meet the policy.');
    this.name = 'PasswordPolicyError';
  }
}

export type IdentityOperationCode = 'NOT_FOUND' | 'ALREADY_EXISTS' | 'INVALID_INPUT';

/** Raised by administrative (CLI) operations; never returned to HTTP clients verbatim. */
export class IdentityOperationError extends Error {
  public constructor(
    public readonly code: IdentityOperationCode,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityOperationError';
  }
}

type LoginFailureReason = 'UNKNOWN_ACCOUNT' | 'INVALID_PASSWORD' | 'LOCKED' | 'DISABLED';

const CLI_CHANNEL = { channel: 'CLI' } as const;

export type IdentityService = ReturnType<typeof createIdentityService>;

export function createIdentityService({
  audit,
  clock = () => new Date(),
  config,
  prisma,
}: IdentityServiceOptions) {
  let dummyHash: Promise<string> | null = null;

  /** Hash used when the account does not exist so failures cost the same Argon2 work. */
  function getDummyHash(): Promise<string> {
    dummyHash ??= argon2.hash(randomBytes(32).toString('hex'));
    return dummyHash;
  }

  async function verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Anonymized accounts store an empty hash; any malformed hash is a failed verification.
      return false;
    }
  }

  async function failLogin(
    reason: LoginFailureReason,
    requestId: string,
    user: User | null,
  ): Promise<never> {
    await audit.recordSafely({
      actorId: user?.id ?? null,
      eventType: 'LOGIN_FAILURE',
      metadata: { reason },
      outcome: 'FAILURE',
      requestId,
      resourceId: user?.id ?? null,
      resourceType: 'USER',
    });
    throw new AuthenticationFailedError();
  }

  async function authenticate(
    emailInput: string,
    password: string,
    requestId: string,
  ): Promise<User> {
    const email = normalizeEmail(emailInput);
    const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
    const now = clock();

    if (!user) {
      await verifyPassword(await getDummyHash(), password);
      return failLogin('UNKNOWN_ACCOUNT', requestId, null);
    }

    if (user.disabledAt) {
      await verifyPassword(await getDummyHash(), password);
      return failLogin('DISABLED', requestId, user);
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      await verifyPassword(await getDummyHash(), password);
      return failLogin('LOCKED', requestId, user);
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      await registerFailedAttempt(user.id, now, requestId);
      return failLogin('INVALID_PASSWORD', requestId, user);
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        data: { failedLoginCount: 0, failedLoginWindowStartedAt: null, lockedUntil: null },
        where: { id: user.id },
      });
      await audit.record(
        {
          actorId: user.id,
          eventType: 'LOGIN_SUCCESS',
          outcome: 'SUCCESS',
          requestId,
          resourceId: user.id,
          resourceType: 'USER',
        },
        tx,
      );

      return updated;
    });
  }

  async function registerFailedAttempt(userId: string, now: Date, requestId: string) {
    await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const windowStart = current.failedLoginWindowStartedAt;
      const windowExpired =
        !windowStart || now.getTime() - windowStart.getTime() > config.loginLockoutWindowMs;
      const failedLoginCount = windowExpired ? 1 : current.failedLoginCount + 1;

      if (failedLoginCount < config.loginLockoutThreshold) {
        await tx.user.update({
          data: {
            failedLoginCount,
            failedLoginWindowStartedAt: windowExpired ? now : windowStart,
          },
          where: { id: userId },
        });
        return;
      }

      await tx.user.update({
        data: {
          failedLoginCount: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: new Date(now.getTime() + config.loginLockoutDurationMs),
        },
        where: { id: userId },
      });
      await audit.record(
        {
          actorId: userId,
          eventType: 'ACCOUNT_LOCKED',
          metadata: { lockMinutes: Math.round(config.loginLockoutDurationMs / 60_000) },
          outcome: 'FAILURE',
          requestId,
          resourceId: userId,
          resourceType: 'USER',
        },
        tx,
      );
    });
  }

  async function changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    currentSessionId: string;
    requestId: string;
  }): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: input.userId } });

    if (
      !user ||
      user.disabledAt ||
      !(await verifyPassword(user.passwordHash, input.currentPassword))
    ) {
      throw new AuthenticationFailedError();
    }

    await assertPasswordAllowed(input.newPassword, user);
    const passwordHash = await argon2.hash(input.newPassword);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        data: { passwordChangeRequired: false, passwordChangedAt: clock(), passwordHash },
        where: { id: user.id },
      });
      const signedOutOtherCount = await revokeSessions(tx, user.id, input.currentSessionId);
      await audit.record(
        {
          actorId: user.id,
          eventType: 'PASSWORD_CHANGED',
          metadata: { signedOutOtherCount },
          outcome: 'SUCCESS',
          requestId: input.requestId,
          resourceId: user.id,
          resourceType: 'USER',
        },
        tx,
      );
    });
  }

  async function assertPasswordAllowed(
    password: string,
    user: Pick<User, 'email' | 'passwordHash'>,
  ) {
    const violations = checkPassword(password, user.email);

    if (user.passwordHash && (await verifyPassword(user.passwordHash, password))) {
      violations.push('MATCHES_CURRENT');
    }

    if (violations.length > 0) {
      throw new PasswordPolicyError(violations);
    }
  }

  // ----- Administrative operations (Identity Admin CLI, D3-1/D3-2/D3-7) -----

  async function createUser(input: {
    email: string;
    role: string;
    password: string;
    requestId: string;
  }): Promise<User> {
    const email = normalizeEmail(input.email);

    if (!email) {
      throw new IdentityOperationError('INVALID_INPUT', 'Enter a valid e-mail address.');
    }

    const role = requireRole(input.role);
    const violations = checkPassword(input.password, email);

    if (violations.length > 0) {
      throw new PasswordPolicyError(violations);
    }

    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new IdentityOperationError(
        'ALREADY_EXISTS',
        'An account with that e-mail already exists.',
      );
    }

    const passwordHash = await argon2.hash(input.password);

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordChangeRequired: true, passwordHash, role },
      });
      await audit.record(
        {
          actorId: null,
          eventType: 'USER_CREATED',
          metadata: { ...CLI_CHANNEL, role },
          outcome: 'SUCCESS',
          requestId: input.requestId,
          resourceId: user.id,
          resourceType: 'USER',
        },
        tx,
      );

      return user;
    });
  }

  async function resetPassword(input: {
    email: string;
    temporaryPassword: string;
    requestId: string;
  }): Promise<void> {
    const user = await requireUser(input.email);
    await assertPasswordAllowed(input.temporaryPassword, user);
    const passwordHash = await argon2.hash(input.temporaryPassword);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        data: {
          failedLoginCount: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: null,
          passwordChangeRequired: true,
          passwordHash,
        },
        where: { id: user.id },
      });
      const signedOutCount = await revokeSessions(tx, user.id);
      await audit.record(
        {
          actorId: null,
          eventType: 'PASSWORD_RESET',
          metadata: { ...CLI_CHANNEL, signedOutCount },
          outcome: 'SUCCESS',
          requestId: input.requestId,
          resourceId: user.id,
          resourceType: 'USER',
        },
        tx,
      );
    });
  }

  async function setDisabled(input: {
    email: string;
    disabled: boolean;
    requestId: string;
  }): Promise<void> {
    const user = await requireUser(input.email);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        data: { disabledAt: input.disabled ? clock() : null },
        where: { id: user.id },
      });
      const signedOutCount = input.disabled ? await revokeSessions(tx, user.id) : 0;
      await audit.record(
        {
          actorId: null,
          eventType: input.disabled ? 'USER_DISABLED' : 'USER_ENABLED',
          metadata: input.disabled ? { ...CLI_CHANNEL, signedOutCount } : CLI_CHANNEL,
          outcome: 'SUCCESS',
          requestId: input.requestId,
          resourceId: user.id,
          resourceType: 'USER',
        },
        tx,
      );
    });
  }

  async function setRole(input: { email: string; role: string; requestId: string }): Promise<void> {
    const user = await requireUser(input.email);
    const role = requireRole(input.role);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ data: { role }, where: { id: user.id } });
      const signedOutCount = await revokeSessions(tx, user.id);
      await audit.record(
        {
          actorId: null,
          eventType: 'USER_ROLE_CHANGED',
          metadata: { ...CLI_CHANNEL, from: user.role, signedOutCount, to: role },
          outcome: 'SUCCESS',
          requestId: input.requestId,
          resourceId: user.id,
          resourceType: 'USER',
        },
        tx,
      );
    });
  }

  /**
   * Removes personal data but keeps the row, because AuditEvent rows reference the user and
   * the append-only trigger rejects the ON DELETE SET NULL update a hard delete would cause.
   */
  async function anonymizeUser(input: { email: string; requestId: string }): Promise<void> {
    const user = await requireUser(input.email);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        data: {
          disabledAt: user.disabledAt ?? clock(),
          email: `deleted+${user.id}@invalid`,
          failedLoginCount: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: null,
          passwordChangeRequired: true,
          passwordHash: '',
        },
        where: { id: user.id },
      });
      const signedOutCount = await revokeSessions(tx, user.id);
      await audit.record(
        {
          actorId: null,
          eventType: 'USER_ANONYMIZED',
          metadata: { ...CLI_CHANNEL, signedOutCount },
          outcome: 'SUCCESS',
          requestId: input.requestId,
          resourceId: user.id,
          resourceType: 'USER',
        },
        tx,
      );
    });
  }

  async function requireUser(emailInput: string): Promise<User> {
    const email = normalizeEmail(emailInput);
    const user = email ? await prisma.user.findUnique({ where: { email } }) : null;

    if (!user) {
      throw new IdentityOperationError('NOT_FOUND', 'No account matches that e-mail address.');
    }

    return user;
  }

  return {
    anonymizeUser,
    authenticate,
    changePassword,
    createUser,
    findUserById: (id: string) => prisma.user.findUnique({ where: { id } }),
    resetPassword,
    setDisabled,
    setRole,
  };
}

/** Revokes the user's active sessions, optionally keeping one; returns how many were revoked. */
async function revokeSessions(
  tx: TransactionClient,
  userId: string,
  keepSessionId?: string,
): Promise<number> {
  const result = await tx.session.updateMany({
    data: { revokedAt: new Date() },
    where: {
      revokedAt: null,
      userId,
      ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
    },
  });

  return result.count;
}

export function normalizeEmail(value: string): string | null {
  const result = emailSchema.safeParse(value);
  return result.success ? result.data : null;
}

function requireRole(value: string): UserRole {
  if (!isUserRole(value)) {
    throw new IdentityOperationError('INVALID_INPUT', 'Role must be USER, AUDITOR or ADMIN.');
  }

  return value;
}

/** Public projection of a user; never includes the hash, lockout state or timestamps. */
export function toAuthenticatedUser(user: User): AuthenticatedUser {
  const role: UserRole = isUserRole(user.role) ? user.role : 'USER';

  return {
    email: user.email,
    id: user.id,
    passwordChangeRequired: user.passwordChangeRequired,
    permissions: isUserRole(user.role) ? [...permissionsForRole(role)] : [],
    role,
  };
}
