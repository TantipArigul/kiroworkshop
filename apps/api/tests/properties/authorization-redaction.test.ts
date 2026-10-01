import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { redactAuditMetadata } from '../../src/shared/audit.js';
import { canAccessOwnedResource } from '../../src/shared/authorization.js';

describe('Foundation correctness properties', () => {
  it('never grants resource access to a distinct user without explicit permission', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (ownerId, actorId) => {
        if (ownerId === actorId) {
          return true;
        }

        return !canAccessOwnedResource({ role: 'ADMIN', userId: actorId }, ownerId);
      }),
      { numRuns: 100 },
    );
  });

  it('redacts generated secret markers at every nested sensitive key', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (secret, requestId) => {
        const redacted = redactAuditMetadata({
          nested: {
            csrfToken: secret,
            requestId,
          },
          password: secret,
          safe: requestId,
        }) as {
          nested: { csrfToken: string; requestId: string };
          password: string;
          safe: string;
        };

        return (
          redacted.password === '[REDACTED]' &&
          redacted.nested.csrfToken === '[REDACTED]' &&
          redacted.nested.requestId === requestId &&
          redacted.safe === requestId
        );
      }),
      { numRuns: 100 },
    );
  });

  it('preserves explicitly granted access for the requested permission only', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        fc.string({ minLength: 1 }),
        (ownerId, actorId, permission) => {
          if (ownerId === actorId) {
            return true;
          }

          return canAccessOwnedResource(
            { explicitPermissions: [permission], role: 'USER', userId: actorId },
            ownerId,
            permission,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  expect.hasAssertions();
});
