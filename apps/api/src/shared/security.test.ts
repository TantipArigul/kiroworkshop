import { describe, expect, it } from 'vitest';

import { redactAuditMetadata } from './audit.js';
import {
  assertOwnedResourceAccess,
  AuthorizationError,
  canAccessOwnedResource,
} from './authorization.js';

describe('security contracts', () => {
  it('permits only owners or explicitly granted users', () => {
    const owner = { role: 'USER' as const, userId: 'usr_owner' };
    const otherUser = { role: 'ADMIN' as const, userId: 'usr_other' };

    expect(canAccessOwnedResource(owner, 'usr_owner')).toBe(true);
    expect(canAccessOwnedResource(otherUser, 'usr_owner')).toBe(false);
    expect(canAccessOwnedResource(otherUser, 'usr_owner', 'job:read:usr_owner')).toBe(false);
    expect(
      canAccessOwnedResource(
        { ...otherUser, explicitPermissions: ['job:read:usr_owner'] },
        'usr_owner',
        'job:read:usr_owner',
      ),
    ).toBe(true);
  });

  it('returns a safe authorization failure without revealing resource existence', () => {
    expect(() =>
      assertOwnedResourceAccess({ role: 'USER', userId: 'usr_other' }, 'usr_owner'),
    ).toThrow(AuthorizationError);
    expect(() =>
      assertOwnedResourceAccess({ role: 'USER', userId: 'usr_other' }, 'usr_owner'),
    ).toThrow('The requested resource is unavailable.');
  });

  it('redacts sensitive audit metadata recursively', () => {
    expect(
      redactAuditMetadata({
        password: 'never-log-this',
        safe: 'visible',
        nested: { csrfToken: 'hidden', requestId: 'req_1' },
      }),
    ).toEqual({
      password: '[REDACTED]',
      safe: 'visible',
      nested: { csrfToken: '[REDACTED]', requestId: 'req_1' },
    });
  });
});
