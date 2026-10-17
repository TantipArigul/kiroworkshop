/**
 * Jobs maintenance CLI — Twelve-Factor one-off admin process (design C7).
 *
 *   node --env-file=.env apps/api/dist/cli/jobs.js jobs:cleanup
 *
 * The API already runs the same sweep every RETENTION_SWEEP_INTERVAL_MS; use this command to run
 * it on demand (for example after downtime). Output contains counts only.
 */
import { randomUUID } from 'node:crypto';

import { ConfigValidationError, loadConfig } from '../config/index.js';
import { createPrismaClient } from '../infrastructure/prisma.js';
import { createAuditService } from '../modules/audit/audit.service.js';
import { createJobStorage } from '../modules/jobs/job-storage.js';
import { createJobService } from '../modules/jobs/job.service.js';
import { createRetentionSweeper } from '../modules/jobs/retention.js';
import { createLogger } from '../shared/logger.js';

const USAGE = `Usage: jobs <command>

  jobs:cleanup   Delete jobs past their retention date (JOB_RETENTION_DAYS, default 7) together
                 with their input, results and storage directory, and remove orphaned directories.`;

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (command !== 'jobs:cleanup' || rest.length > 0) {
    process.stderr.write(
      `${command ? `Unknown command "${command}".` : 'Missing command.'}\n\n${USAGE}\n`,
    );
    return 2;
  }

  let config: ReturnType<typeof loadConfig>;

  try {
    config = loadConfig(process.env);
  } catch (error) {
    const fields = error instanceof ConfigValidationError ? error.fields.join(', ') : 'unknown';
    process.stderr.write(`Configuration is invalid (${fields}). Check the environment file.\n`);
    return 1;
  }

  const prisma = createPrismaClient(config.databaseUrl);
  const logger = createLogger(config);
  const audit = createAuditService(prisma, logger);
  const storage = createJobStorage(config.storageRoot);
  // Cleanup never creates jobs, so executor readiness is irrelevant here.
  const jobs = createJobService({
    audit,
    config,
    isExecutorReady: () => false,
    logger,
    prisma,
    storage,
  });
  const sweep = createRetentionSweeper({ audit, jobs, logger, prisma, storage });

  try {
    const result = await sweep({ requestId: `cli-${randomUUID()}` });
    process.stdout.write(
      `Deleted ${result.deleted} expired job(s); ${result.failed} failed; removed ${result.orphansRemoved} orphaned director${result.orphansRemoved === 1 ? 'y' : 'ies'}.\n`,
    );
    return result.failed > 0 ? 1 : 0;
  } catch (error) {
    logger.error(
      { errorType: error instanceof Error ? error.name : 'unknown' },
      'jobs:cleanup failed',
    );
    process.stderr.write('The command failed. Check the application logs for details.\n');
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

process.exitCode = await main(process.argv.slice(2));
