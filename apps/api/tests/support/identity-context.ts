import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import type { Express } from 'express';

import { loadConfig, type AppConfig } from '../../src/config/index.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createApiApp } from '../../src/http/app.js';
import { createPrismaClient } from '../../src/infrastructure/prisma.js';
import { createTestDatabaseContext } from '../../src/infrastructure/test-database.js';
import { createAuditService } from '../../src/modules/audit/audit.service.js';
import {
  createIdentityService,
  type IdentityService,
} from '../../src/modules/identity/identity.service.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../prisma/migrations/', import.meta.url));

/** Synthetic password that satisfies the policy; never a real credential. */
export const TEST_PASSWORD = 'synthetic-pass-for-tests-01';
export const OTHER_PASSWORD = 'another-synthetic-pass-02';

export type IdentityTestContext = {
  app: Express;
  config: AppConfig;
  identity: IdentityService;
  prisma: PrismaClient;
  /** Creates an account; `ready: true` clears the forced password change. */
  createUser: (
    email: string,
    role?: 'USER' | 'AUDITOR' | 'ADMIN',
    options?: { ready?: boolean; password?: string },
  ) => Promise<{ id: string; email: string }>;
  cleanup: () => Promise<void>;
};

/** Applies every Prisma migration (including the AuditEvent triggers) to a fresh SQLite file. */
function applyMigrations(databaseUrl: string) {
  const database = new Database(databaseUrl.replace(/^file:/, ''));

  try {
    for (const entry of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => item.name)
      .sort()) {
      database.exec(readFileSync(join(MIGRATIONS_DIR, entry, 'migration.sql'), 'utf8'));
    }
  } finally {
    database.close();
  }
}

export async function createIdentityTestContext(
  environment: Record<string, string> = {},
): Promise<IdentityTestContext> {
  const database = await createTestDatabaseContext();
  applyMigrations(database.databaseUrl);

  const config = loadConfig({
    ALLOWED_ORIGINS: 'https://localhost',
    DATABASE_URL: database.databaseUrl,
    // High enough that the IP limiter never masks account-level behaviour in tests.
    LOGIN_RATE_LIMIT_MAX: '10000',
    LOG_LEVEL: 'fatal',
    NODE_ENV: 'test',
    SESSION_SECRET: 'a-secure-test-session-secret-with-32-chars',
    STORAGE_ROOT: database.directory,
    ...environment,
  });
  const prisma = createPrismaClient(config.databaseUrl);
  const audit = createAuditService(prisma, { error: () => undefined });
  const identity = createIdentityService({ audit, config, prisma });
  const app = createApiApp(config, prisma);

  return {
    app,
    cleanup: async () => {
      await prisma.$disconnect();
      await database.cleanup();
    },
    config,
    createUser: async (email, role = 'USER', options = {}) => {
      const user = await identity.createUser({
        email,
        password: options.password ?? TEST_PASSWORD,
        requestId: 'test-setup',
        role,
      });

      if (options.ready) {
        await prisma.user.update({
          data: { passwordChangeRequired: false },
          where: { id: user.id },
        });
      }

      return { email: user.email, id: user.id };
    },
    identity,
    prisma,
  };
}
