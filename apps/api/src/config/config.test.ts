import { describe, expect, it } from 'vitest';

import { ConfigValidationError, loadConfig } from './config.js';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL: 'file:./data/test.db',
  SESSION_SECRET: 'a-secure-test-session-secret-with-32-chars',
  ALLOWED_ORIGINS: 'https://localhost,https://portal.example.test',
  LOG_LEVEL: 'info',
  SHUTDOWN_TIMEOUT_MS: '30000',
  STORAGE_ROOT: '/tmp/portal-private',
  PAGE_SIZE_DEFAULT: '20',
  PAGE_SIZE_MAX: '100',
  LOGIN_RATE_LIMIT_MAX: '5',
  AUTH_RATE_LIMIT_MAX: '120',
  SUBMIT_RATE_LIMIT_MAX: '10',
};

describe('loadConfig', () => {
  it('returns normalized configuration from valid environment values', () => {
    const config = loadConfig(validEnvironment);

    expect(config.port).toBe(3001);
    expect(config.allowedOrigins).toEqual(['https://localhost', 'https://portal.example.test']);
    expect(config.pageSizeDefault).toBe(20);
    expect(config.sessionSecret).toBe(validEnvironment.SESSION_SECRET);
  });

  it('does not expose a secret when configuration is invalid', () => {
    const invalidEnvironment = {
      ...validEnvironment,
      SESSION_SECRET: 'exposed-secret-value',
    };

    expect(() => loadConfig(invalidEnvironment)).toThrow(ConfigValidationError);

    try {
      loadConfig(invalidEnvironment);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as Error).message).not.toContain('exposed-secret-value');
      expect((error as ConfigValidationError).fields).toEqual(['SESSION_SECRET']);
    }
  });

  it('rejects non-HTTPS origins, relative storage paths and oversized default pages', () => {
    const invalidEnvironment = {
      ...validEnvironment,
      ALLOWED_ORIGINS: 'http://localhost',
      STORAGE_ROOT: 'relative-storage',
      PAGE_SIZE_DEFAULT: '101',
    };

    expect(() => loadConfig(invalidEnvironment)).toThrow(ConfigValidationError);
  });

  it('applies identity session, lockout and audit retention defaults', () => {
    const config = loadConfig(validEnvironment);

    expect(config.sessionIdleTimeoutMs).toBe(30 * 60_000);
    expect(config.sessionAbsoluteTimeoutMs).toBe(8 * 60 * 60_000);
    expect(config.loginLockoutThreshold).toBe(5);
    expect(config.loginLockoutWindowMs).toBe(15 * 60_000);
    expect(config.loginLockoutDurationMs).toBe(15 * 60_000);
    expect(config.auditRetentionDays).toBe(90);
  });

  it('rejects an idle timeout longer than the absolute timeout', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        SESSION_IDLE_TIMEOUT_MINUTES: '120',
        SESSION_ABSOLUTE_TIMEOUT_HOURS: '1',
      }),
    ).toThrow(ConfigValidationError);
  });

  it('rejects an audit retention shorter than the database trigger window', () => {
    try {
      loadConfig({ ...validEnvironment, AUDIT_RETENTION_DAYS: '30' });
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigValidationError).fields).toEqual(['AUDIT_RETENTION_DAYS']);
    }
  });
});
