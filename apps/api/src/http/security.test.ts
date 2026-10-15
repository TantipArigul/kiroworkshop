import { describe, expect, it } from 'vitest';

import { createRateLimiters, generateCsrfToken } from './security.js';

describe('HTTP security middleware contracts', () => {
  it('exposes distinct rate limiter middleware for login, authenticated API and submission routes', () => {
    const rateLimiters = createRateLimiters({
      appEnvironment: 'test',
      authRateLimitMax: 120,
      allowedOrigins: ['https://localhost'],
      databaseUrl: 'file:./data/test.db',
      logLevel: 'info',
      loginRateLimitMax: 5,
      pageSizeDefault: 20,
      pageSizeMax: 100,
      port: 3000,
      sessionSecret: 'a-secure-test-session-secret-with-32-chars',
      shutdownTimeoutMs: 30000,
      storageRoot: '/tmp/portal-private',
      submitRateLimitMax: 10,
      sessionIdleTimeoutMs: 30 * 60_000,
      sessionAbsoluteTimeoutMs: 8 * 60 * 60_000,
      loginLockoutThreshold: 5,
      loginLockoutWindowMs: 15 * 60_000,
      loginLockoutDurationMs: 15 * 60_000,
      auditRetentionDays: 90,
    });

    expect(rateLimiters.login).not.toBe(rateLimiters.authenticatedApi);
    expect(rateLimiters.submit).not.toBe(rateLimiters.login);
  });

  it('exports a CSRF token generator for session-backed routes', () => {
    expect(generateCsrfToken).toBeTypeOf('function');
  });
});
