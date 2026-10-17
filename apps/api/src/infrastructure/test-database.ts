import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

export type TestDatabaseContext = {
  directory: string;
  databaseUrl: string;
  cleanup: () => Promise<void>;
};

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../prisma/migrations/', import.meta.url));

export async function createTestDatabaseContext(): Promise<TestDatabaseContext> {
  const directory = await mkdtemp(join(tmpdir(), 'smart-checkup-portal-'));
  const databaseUrl = `file:${join(directory, 'portal.db')}`;

  return {
    directory,
    databaseUrl,
    cleanup: async () => rm(directory, { force: true, recursive: true }),
  };
}

/** Applies every Prisma migration (including SQL triggers) to a fresh SQLite test file. */
export function applyTestMigrations(databaseUrl: string): void {
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
