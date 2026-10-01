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
});
