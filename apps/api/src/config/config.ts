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
};

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
  })
  .superRefine((value, context) => {
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

export function loadConfig(environment: Environment): AppConfig {
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
