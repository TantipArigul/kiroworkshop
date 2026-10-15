import { access } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { resolvePrivateStoragePath, StoragePathError } from './storage-path.js';
import { createTestDatabaseContext } from './test-database.js';

const testContexts: Awaited<ReturnType<typeof createTestDatabaseContext>>[] = [];

afterEach(async () => {
  await Promise.all(testContexts.splice(0).map((context) => context.cleanup()));
});

describe('persistence foundation', () => {
  it('resolves storage keys only within the private root', () => {
    expect(resolvePrivateStoragePath('/var/lib/portal-private', 'jobs/job_1/input.json')).toBe(
      '/var/lib/portal-private/jobs/job_1/input.json',
    );
    expect(() => resolvePrivateStoragePath('/var/lib/portal-private', '../outside.txt')).toThrow(
      StoragePathError,
    );
  });

  it('creates and cleans an isolated SQLite test database context', async () => {
    const context = await createTestDatabaseContext();
    testContexts.push(context);

    expect(context.databaseUrl).toContain('portal.db');
    await access(context.directory);
    await context.cleanup();
    testContexts.splice(testContexts.indexOf(context), 1);

    await expect(access(context.directory)).rejects.toThrow();
  });
});
