import { isAbsolute } from 'node:path';

import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

type Environment = Record<string, string | undefined>;

export type AppConfig = {
  appEnvironment: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  allowedOrigins: readonly string[];
  logLevel: (typeof LOG_LEVELS)[number];
  shutdownTimeoutMs: number;
  storageRoot: string;
  pageSizeDefault: number;
  pageSizeMax: number;
  loginRateLimitMax: number;
  authRateLimitMax: number;
  submitRateLimitMax: number;
  sessionIdleTimeoutMs: number;
  sessionAbsoluteTimeoutMs: number;
  loginLockoutThreshold: number;
  loginLockoutWindowMs: number;
  loginLockoutDurationMs: number;
  auditRetentionDays: number;
  executorEnabled: boolean;
  executorPollIntervalMs: number;
  executorQueuedDelayMs: number;
  executorRunningDelayMs: number;
  jobRetentionDays: number;
  retentionSweepIntervalMs: number;
};

/**
 * Pipeline Catalog & Nextflow executor settings. Kept as a separate type so modules that only
 * need the core settings (and their test fixtures) keep accepting `AppConfig`.
 */
export type NextflowConfig = {
  nextflowEnabled: boolean;
  nextflowBin: string;
  dockerBin: string;
  /** Passed to child processes as `NXF_HOME`; `null` keeps Nextflow's default. */
  nextflowHome: string | null;
  nextflowMaxConcurrentRuns: number;
  nextflowMaxCpus: number;
  nextflowMaxMemoryGb: number;
  nextflowMaxTimeHours: number;
  nextflowCancelGraceMs: number;
  nextflowReadinessIntervalMs: number;
};

/** Everything `loadConfig` returns. */
export type PortalConfig = AppConfig & NextflowConfig;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
// Must not be lower than the retention window enforced by the AuditEvent delete trigger.
const AUDIT_RETENTION_DAYS_MIN = 90;

export class ConfigValidationError extends Error {
  public readonly fields: readonly string[];

  public constructor(fields: readonly string[]) {
    super('Application configuration is invalid.');
    this.name = 'ConfigValidationError';
    this.fields = fields;
  }
}

const rawConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().regex(/^file:/, 'Must be a SQLite file URL.'),
    SESSION_SECRET: z.string().min(32),
    ALLOWED_ORIGINS: z.string().min(1),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    STORAGE_ROOT: z.string().min(1),
    PAGE_SIZE_DEFAULT: z.coerce.number().int().min(1).default(20),
    PAGE_SIZE_MAX: z.coerce.number().int().min(1).max(100).default(100),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    SUBMIT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().min(1).max(24).default(8),
    LOGIN_LOCKOUT_THRESHOLD: z.coerce.number().int().min(1).max(100).default(5),
    LOGIN_LOCKOUT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    LOGIN_LOCKOUT_DURATION_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    AUDIT_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(AUDIT_RETENTION_DAYS_MIN)
      .max(3650)
      .default(90),
    EXECUTOR_ENABLED: z.enum(['true', 'false']).default('true'),
    EXECUTOR_POLL_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(2000),
    EXECUTOR_QUEUED_DELAY_MS: z.coerce.number().int().min(0).max(600_000).default(3000),
    EXECUTOR_RUNNING_DELAY_MS: z.coerce.number().int().min(0).max(600_000).default(5000),
    // The approved retention policy is seven days; shorter windows are allowed for demos.
    JOB_RETENTION_DAYS: z.coerce.number().int().min(1).max(7).default(7),
    RETENTION_SWEEP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(3_600_000),
    // Pipeline Catalog & Nextflow Executor. Disabled by default (Compose/CI); enable on a host
    // that has Nextflow and Docker Desktop.
    NEXTFLOW_ENABLED: z.enum(['true', 'false']).default('false'),
    NEXTFLOW_BIN: z.string().min(1).max(4096).default('nextflow'),
    DOCKER_BIN: z.string().min(1).max(4096).default('docker'),
    NEXTFLOW_HOME: z
      .string()
      .max(4096)
      .optional()
      .transform((value) => (value ? value : undefined)),
    NEXTFLOW_MAX_CONCURRENT_RUNS: z.coerce.number().int().min(1).max(4).default(1),
    NEXTFLOW_MAX_CPUS: z.coerce.number().int().min(1).max(16).default(4),
    NEXTFLOW_MAX_MEMORY_GB: z.coerce.number().int().min(2).max(64).default(8),
    NEXTFLOW_MAX_TIME_HOURS: z.coerce.number().int().min(1).max(48).default(8),
    NEXTFLOW_CANCEL_GRACE_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    NEXTFLOW_READINESS_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(600_000)
      .default(60_000),
  })
  .superRefine((value, context) => {
    if (value.NEXTFLOW_HOME !== undefined && !isAbsolute(value.NEXTFLOW_HOME)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must be an absolute path.',
        path: ['NEXTFLOW_HOME'],
      });
    }

    if (
      value.SESSION_IDLE_TIMEOUT_MINUTES * MINUTE_MS >
      value.SESSION_ABSOLUTE_TIMEOUT_HOURS * HOUR_MS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must not exceed the absolute session timeout.',
        path: ['SESSION_IDLE_TIMEOUT_MINUTES'],
      });
    }

    if (!isAbsolute(value.STORAGE_ROOT)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must be an absolute path.',
        path: ['STORAGE_ROOT'],
      });
    }

    if (value.PAGE_SIZE_DEFAULT > value.PAGE_SIZE_MAX) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must not exceed PAGE_SIZE_MAX.',
        path: ['PAGE_SIZE_DEFAULT'],
      });
    }
  });

export function loadConfig(environment: Environment): PortalConfig {
  const parsedConfig = rawConfigSchema.safeParse(environment);

  if (!parsedConfig.success) {
    const fields = [
      ...new Set(parsedConfig.error.issues.map((issue) => issue.path.join('.'))),
    ].sort();
    throw new ConfigValidationError(fields);
  }

  const allowedOrigins = parsedConfig.data.ALLOWED_ORIGINS.split(',').map((origin) =>
    origin.trim(),
  );

  if (allowedOrigins.some((origin) => !isAllowedOrigin(origin))) {
    throw new ConfigValidationError(['ALLOWED_ORIGINS']);
  }

  return {
    appEnvironment: parsedConfig.data.NODE_ENV,
    port: parsedConfig.data.PORT,
    databaseUrl: parsedConfig.data.DATABASE_URL,
    sessionSecret: parsedConfig.data.SESSION_SECRET,
    allowedOrigins,
    logLevel: parsedConfig.data.LOG_LEVEL,
    shutdownTimeoutMs: parsedConfig.data.SHUTDOWN_TIMEOUT_MS,
    storageRoot: parsedConfig.data.STORAGE_ROOT,
    pageSizeDefault: parsedConfig.data.PAGE_SIZE_DEFAULT,
    pageSizeMax: parsedConfig.data.PAGE_SIZE_MAX,
    loginRateLimitMax: parsedConfig.data.LOGIN_RATE_LIMIT_MAX,
    authRateLimitMax: parsedConfig.data.AUTH_RATE_LIMIT_MAX,
    submitRateLimitMax: parsedConfig.data.SUBMIT_RATE_LIMIT_MAX,
    sessionIdleTimeoutMs: parsedConfig.data.SESSION_IDLE_TIMEOUT_MINUTES * MINUTE_MS,
    sessionAbsoluteTimeoutMs: parsedConfig.data.SESSION_ABSOLUTE_TIMEOUT_HOURS * HOUR_MS,
    loginLockoutThreshold: parsedConfig.data.LOGIN_LOCKOUT_THRESHOLD,
    loginLockoutWindowMs: parsedConfig.data.LOGIN_LOCKOUT_WINDOW_MINUTES * MINUTE_MS,
    loginLockoutDurationMs: parsedConfig.data.LOGIN_LOCKOUT_DURATION_MINUTES * MINUTE_MS,
    auditRetentionDays: parsedConfig.data.AUDIT_RETENTION_DAYS,
    executorEnabled: parsedConfig.data.EXECUTOR_ENABLED === 'true',
    executorPollIntervalMs: parsedConfig.data.EXECUTOR_POLL_INTERVAL_MS,
    executorQueuedDelayMs: parsedConfig.data.EXECUTOR_QUEUED_DELAY_MS,
    executorRunningDelayMs: parsedConfig.data.EXECUTOR_RUNNING_DELAY_MS,
    jobRetentionDays: parsedConfig.data.JOB_RETENTION_DAYS,
    retentionSweepIntervalMs: parsedConfig.data.RETENTION_SWEEP_INTERVAL_MS,
    nextflowEnabled: parsedConfig.data.NEXTFLOW_ENABLED === 'true',
    nextflowBin: parsedConfig.data.NEXTFLOW_BIN,
    dockerBin: parsedConfig.data.DOCKER_BIN,
    nextflowHome: parsedConfig.data.NEXTFLOW_HOME ?? null,
    nextflowMaxConcurrentRuns: parsedConfig.data.NEXTFLOW_MAX_CONCURRENT_RUNS,
    nextflowMaxCpus: parsedConfig.data.NEXTFLOW_MAX_CPUS,
    nextflowMaxMemoryGb: parsedConfig.data.NEXTFLOW_MAX_MEMORY_GB,
    nextflowMaxTimeHours: parsedConfig.data.NEXTFLOW_MAX_TIME_HOURS,
    nextflowCancelGraceMs: parsedConfig.data.NEXTFLOW_CANCEL_GRACE_MS,
    nextflowReadinessIntervalMs: parsedConfig.data.NEXTFLOW_READINESS_INTERVAL_MS,
  };
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin;
  } catch {
    return false;
  }
}
