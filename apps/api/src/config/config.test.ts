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

  it('applies executor and job retention defaults', () => {
    const config = loadConfig(validEnvironment);

    expect(config.executorEnabled).toBe(true);
    expect(config.executorPollIntervalMs).toBe(2000);
    expect(config.executorQueuedDelayMs).toBe(3000);
    expect(config.executorRunningDelayMs).toBe(5000);
    expect(config.jobRetentionDays).toBe(7);
    expect(config.retentionSweepIntervalMs).toBe(3_600_000);
    expect(loadConfig({ ...validEnvironment, EXECUTOR_ENABLED: 'false' }).executorEnabled).toBe(
      false,
    );
  });

  it('applies Nextflow defaults with the executor disabled', () => {
    const config = loadConfig(validEnvironment);

    expect(config.nextflowEnabled).toBe(false);
    expect(config.nextflowBin).toBe('nextflow');
    expect(config.dockerBin).toBe('docker');
    expect(config.nextflowHome).toBeNull();
    expect(config.nextflowMaxConcurrentRuns).toBe(1);
    expect(config.nextflowMaxCpus).toBe(4);
    expect(config.nextflowMaxMemoryGb).toBe(8);
    expect(config.nextflowMaxTimeHours).toBe(8);
    expect(config.nextflowCancelGraceMs).toBe(30_000);
    expect(config.nextflowReadinessIntervalMs).toBe(60_000);
    expect(loadConfig({ ...validEnvironment, NEXTFLOW_HOME: '' }).nextflowHome).toBeNull();
  });

  it('reads Nextflow overrides within their ranges', () => {
    const config = loadConfig({
      ...validEnvironment,
      NEXTFLOW_ENABLED: 'true',
      NEXTFLOW_BIN: '/opt/homebrew/bin/nextflow',
      DOCKER_BIN: '/usr/local/bin/docker',
      NEXTFLOW_HOME: '/tmp/nxf-home',
      NEXTFLOW_MAX_CONCURRENT_RUNS: '4',
      NEXTFLOW_MAX_CPUS: '16',
      NEXTFLOW_MAX_MEMORY_GB: '2',
      NEXTFLOW_MAX_TIME_HOURS: '48',
      NEXTFLOW_CANCEL_GRACE_MS: '1000',
      NEXTFLOW_READINESS_INTERVAL_MS: '600000',
    });

    expect(config).toMatchObject({
      dockerBin: '/usr/local/bin/docker',
      nextflowBin: '/opt/homebrew/bin/nextflow',
      nextflowCancelGraceMs: 1000,
      nextflowEnabled: true,
      nextflowHome: '/tmp/nxf-home',
      nextflowMaxConcurrentRuns: 4,
      nextflowMaxCpus: 16,
      nextflowMaxMemoryGb: 2,
      nextflowMaxTimeHours: 48,
      nextflowReadinessIntervalMs: 600_000,
    });
  });

  it('rejects out-of-range Nextflow settings and a relative NEXTFLOW_HOME', () => {
    try {
      loadConfig({
        ...validEnvironment,
        NEXTFLOW_ENABLED: 'yes',
        NEXTFLOW_BIN: '',
        NEXTFLOW_MAX_CONCURRENT_RUNS: '5',
        NEXTFLOW_MAX_CPUS: '0',
        NEXTFLOW_MAX_MEMORY_GB: '1',
        NEXTFLOW_MAX_TIME_HOURS: '49',
        NEXTFLOW_CANCEL_GRACE_MS: '999',
        NEXTFLOW_READINESS_INTERVAL_MS: '600001',
      });
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigValidationError).fields).toEqual([
        'NEXTFLOW_BIN',
        'NEXTFLOW_CANCEL_GRACE_MS',
        'NEXTFLOW_ENABLED',
        'NEXTFLOW_MAX_CONCURRENT_RUNS',
        'NEXTFLOW_MAX_CPUS',
        'NEXTFLOW_MAX_MEMORY_GB',
        'NEXTFLOW_MAX_TIME_HOURS',
        'NEXTFLOW_READINESS_INTERVAL_MS',
      ]);
    }

    try {
      loadConfig({ ...validEnvironment, NEXTFLOW_HOME: 'relative/nxf' });
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigValidationError).fields).toEqual(['NEXTFLOW_HOME']);
    }
  });

  it('rejects a job retention longer than the approved seven days', () => {
    try {
      loadConfig({ ...validEnvironment, JOB_RETENTION_DAYS: '8', EXECUTOR_ENABLED: 'yes' });
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigValidationError).fields).toEqual([
        'EXECUTOR_ENABLED',
        'JOB_RETENTION_DAYS',
      ]);
    }
  });
});
