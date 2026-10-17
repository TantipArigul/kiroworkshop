import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../config/config.js';
import { createPrismaClient } from '../infrastructure/prisma.js';
import { createTestDatabaseContext } from '../infrastructure/test-database.js';
import { listenOnLoopback } from '../infrastructure/test-server.js';
import { createApiApp, type ApiRuntimeState } from './app.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../prisma/migrations/', import.meta.url));

// Isolated, freshly migrated SQLite file so the test runs on any machine and never touches dev data.
const database = await createTestDatabaseContext();
const sqlite = new Database(database.databaseUrl.replace(/^file:/, ''));
try {
  for (const entry of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, entry, 'migration.sql'), 'utf8'));
  }
} finally {
  sqlite.close();
}

const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: database.databaseUrl,
  SESSION_SECRET: 'a-secure-test-session-secret-with-32-chars',
  ALLOWED_ORIGINS: 'https://localhost',
  LOG_LEVEL: 'info',
  SHUTDOWN_TIMEOUT_MS: '30000',
  STORAGE_ROOT: database.directory,
  PAGE_SIZE_DEFAULT: '20',
  PAGE_SIZE_MAX: '100',
  LOGIN_RATE_LIMIT_MAX: '5',
  AUTH_RATE_LIMIT_MAX: '120',
  SUBMIT_RATE_LIMIT_MAX: '10',
});
const prisma = createPrismaClient(config.databaseUrl);
const server = await listenOnLoopback(createApiApp(config, prisma));
const app = server.url;

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
  await database.cleanup();
});

describe('Foundation API runtime', () => {
  it('returns safe health and readiness envelopes with request IDs', async () => {
    const healthResponse = await request(app).get('/health').expect(200);
    const readinessResponse = await request(app).get('/health/ready').expect(200);

    expect(healthResponse.body.data.status).toBe('ok');
    expect(healthResponse.body.meta.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(healthResponse.headers['x-request-id']).toBe(healthResponse.body.meta.requestId);
    expect(readinessResponse.body.data).toEqual({
      checks: { database: 'ok' },
      status: 'ready',
    });
  });

  it('returns not-ready safely when a runtime is draining', async () => {
    const drainingState: ApiRuntimeState = { draining: true, startedAt: Date.now() };
    const drainingServer = await listenOnLoopback(createApiApp(config, prisma, drainingState));

    try {
      const response = await request(drainingServer.url).get('/health/ready').expect(503);

      expect(response.body.data.status).toBe('not_ready');
      expect(response.body).not.toHaveProperty('databaseUrl');
    } finally {
      await drainingServer.close();
    }
  });

  it('uses a stateful CSRF token and safe auth errors', async () => {
    const agent = request.agent(app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf-token').expect(200);
    const csrfToken = csrfResponse.body.data.csrfToken as string;
    const csrfDeniedResponse = await agent.post('/api/v1/auth/login').expect(403);
    // Identity & Access replaced the 501 stub: a login without credentials is a validation error.
    const loginWithoutBodyResponse = await agent
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .expect(400);
    const currentUserResponse = await agent.get('/api/v1/auth/me').expect(401);

    expect(csrfToken).toHaveLength(256);
    expect(csrfDeniedResponse.body.error.code).toBe('CSRF_INVALID');
    expect(loginWithoutBodyResponse.body.error.code).toBe('VALIDATION_FAILED');
    expect(currentUserResponse.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(currentUserResponse.body.error.message).not.toContain('session');
  });

  it('rejects disallowed origins without leaking internal details', async () => {
    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://untrusted.example')
      .expect(403);

    expect(response.body.error.code).toBe('AUTHORIZATION_DENIED');
    expect(response.body.error.message).not.toContain('allowlist');
  });
});
