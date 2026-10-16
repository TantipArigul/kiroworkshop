import { describe, expect, it, vi } from 'vitest';

import { createAuditService } from '../../../src/modules/audit/audit.service.js';
import { toAuthenticatedUser } from '../../../src/modules/identity/identity.service.js';
import {
  checkPassword,
  PASSWORD_MIN_LENGTH,
} from '../../../src/modules/identity/password-policy.js';
import { permissionsForRole, ROLE_PERMISSIONS } from '../../../src/modules/identity/permissions.js';

const EMAIL = 'trainee@example.test';

describe('password policy (D3-3)', () => {
  it('accepts a long, uncommon passphrase without composition rules', () => {
    expect(checkPassword('quiet lantern over river', EMAIL)).toEqual([]);
  });

  it('enforces the 12 character minimum counted in Unicode code points', () => {
    expect(checkPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1), EMAIL)).toContain('TOO_SHORT');
    // 12 emoji-free astral characters are 24 UTF-16 units but 12 code points.
    expect(checkPassword('𝒜'.repeat(PASSWORD_MIN_LENGTH), EMAIL)).not.toContain('TOO_SHORT');
    expect(checkPassword('𝒜'.repeat(PASSWORD_MIN_LENGTH - 1), EMAIL)).toContain('TOO_SHORT');
  });

  it('enforces the 1024 character maximum', () => {
    expect(checkPassword('x'.repeat(1025), EMAIL)).toContain('TOO_LONG');
    expect(checkPassword('quietlantern'.repeat(85), EMAIL)).not.toContain('TOO_LONG');
  });

  it('rejects the e-mail address or its local part, ignoring case and spaces', () => {
    expect(checkPassword(' Trainee@Example.TEST ', EMAIL)).toContain('MATCHES_IDENTIFIER');
    expect(checkPassword('TRAINEE', 'trainee@example.test')).toContain('MATCHES_IDENTIFIER');
  });

  it('rejects whole-value denylist matches only (not substrings)', () => {
    expect(checkPassword('password1234', EMAIL)).toContain('COMMON_PASSWORD');
    expect(checkPassword('PASSWORD1234', EMAIL)).toContain('COMMON_PASSWORD');
    expect(checkPassword('my password1234 lantern', EMAIL)).not.toContain('COMMON_PASSWORD');
  });
});

describe('role permission map (D3-6)', () => {
  it('grants USER nothing, AUDITOR audit read and ADMIN audit read plus user management', () => {
    expect(ROLE_PERMISSIONS).toEqual({
      ADMIN: ['AUDIT_READ', 'USER_MANAGE'],
      AUDITOR: ['AUDIT_READ'],
      USER: [],
    });
  });

  it('fails closed for unknown roles', () => {
    expect(permissionsForRole('ROOT')).toEqual([]);
    expect(permissionsForRole('')).toEqual([]);
  });

  it('projects users without hash, lockout or timestamps and downgrades unknown roles', () => {
    const base = {
      createdAt: new Date(),
      disabledAt: null,
      email: EMAIL,
      failedLoginCount: 3,
      failedLoginWindowStartedAt: new Date(),
      id: 'usr_1',
      lockedUntil: null,
      passwordChangeRequired: true,
      passwordChangedAt: null,
      passwordHash: '$argon2id$secret',
    };

    expect(toAuthenticatedUser({ ...base, role: 'AUDITOR' })).toEqual({
      email: EMAIL,
      id: 'usr_1',
      passwordChangeRequired: true,
      permissions: ['AUDIT_READ'],
      role: 'AUDITOR',
    });
    expect(toAuthenticatedUser({ ...base, role: 'ROOT' })).toMatchObject({
      permissions: [],
      role: 'USER',
    });
  });
});

describe('audit service metadata handling (D3-8)', () => {
  function createWriter() {
    const create = vi.fn().mockResolvedValue({ id: 'aud_1' });
    return {
      create,
      audit: createAuditService({ auditEvent: { create } } as never, { error: vi.fn() }),
    };
  }

  it('drops metadata keys outside the event allowlist and redacts the rest', async () => {
    const { audit, create } = createWriter();

    await audit.record({
      actorId: 'usr_1',
      eventType: 'LOGIN_FAILURE',
      metadata: { email: EMAIL, password: 'leak', rawInput: 'x', reason: 'INVALID_PASSWORD' },
      outcome: 'FAILURE',
      requestId: 'req_1',
      resourceType: 'USER',
    });

    const stored = create.mock.calls[0]![0].data.metadataJson as string;
    expect(JSON.parse(stored)).toEqual({ reason: 'INVALID_PASSWORD' });
    expect(stored).not.toContain('@');
  });

  it('rejects unknown event types before writing', async () => {
    const { audit, create } = createWriter();

    await expect(
      audit.record({
        eventType: 'MADE_UP' as never,
        outcome: 'SUCCESS',
        requestId: 'req_1',
        resourceType: 'USER',
      }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('logs instead of throwing when a non-state-change event cannot be written', async () => {
    const error = vi.fn();
    const failing = createAuditService(
      { auditEvent: { create: vi.fn().mockRejectedValue(new Error('disk full')) } } as never,
      { error },
    );

    await expect(
      failing.recordSafely({
        eventType: 'AUTHORIZATION_DENIED',
        outcome: 'DENIED',
        requestId: 'req_1',
        resourceType: 'AUDIT',
      }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });
});
