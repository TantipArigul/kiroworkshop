import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type TestDatabaseContext = {
  directory: string;
  databaseUrl: string;
  cleanup: () => Promise<void>;
};

export async function createTestDatabaseContext(): Promise<TestDatabaseContext> {
  const directory = await mkdtemp(join(tmpdir(), 'smart-checkup-portal-'));
  const databaseUrl = `file:${join(directory, 'portal.db')}`;

  return {
    directory,
    databaseUrl,
    cleanup: async () => rm(directory, { force: true, recursive: true }),
  };
}
