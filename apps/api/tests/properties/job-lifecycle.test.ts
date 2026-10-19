import { readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { INPUT_MARKERS, TERMINAL_JOB_STATUSES } from '@portal/shared';
import { idempotencyKeyGenerator, jobStatusGenerator } from '@portal/shared/testing';

import { resolvePrivateStoragePath } from '../../src/infrastructure/storage-path.js';
import { validateInputFile } from '../../src/modules/jobs/input-validator.js';
import { createJobStorage } from '../../src/modules/jobs/job-storage.js';
import { isAllowedTransition } from '../../src/modules/jobs/job.service.js';
import {
  createJobsTestContext,
  SAMPLE_BODY,
  type JobsTestContext,
} from '../support/jobs-context.js';

const RUNS = 100;
const DB_RUNS = 25;

let context: JobsTestContext;
let owner: Awaited<ReturnType<JobsTestContext['signIn']>>;
let intruder: Awaited<ReturnType<JobsTestContext['signIn']>>;

beforeAll(async () => {
  context = await createJobsTestContext();
  owner = await context.signIn('pbt-owner@example.test');
  intruder = await context.signIn('pbt-intruder@example.test');
});

afterAll(async () => {
  await context.cleanup();
});

async function submit(key = crypto.randomUUID(), body: object = SAMPLE_BODY) {
  const response = await owner.post('/api/v1/jobs', body, { 'Idempotency-Key': key });
  return response.body.data.job.id as string;
}

describe('Job lifecycle properties (fast-check)', () => {
  // P7 replaces Unit 2's P1 (Pipeline Catalog design): CANCELLED is reachable from QUEUED and
  // RUNNING only, and no terminal status (COMPLETED, FAILED, CANCELLED) ever changes again.
  it('P7 only QUEUED→RUNNING→COMPLETED|FAILED and QUEUED|RUNNING→CANCELLED are ever applied; terminal statuses never change (US-007 AC4, US-021 AC1, AC4)', async () => {
    const { createJobService } = await import('../../src/modules/jobs/job.service.js');
    const { createAuditService } = await import('../../src/modules/audit/audit.service.js');
    const service = createJobService({
      audit: createAuditService(context.prisma, { error: () => undefined }),
      config: context.config,
      isExecutorReady: () => true,
      logger: { error: () => undefined },
      prisma: context.prisma,
      storage: createJobStorage(context.config.storageRoot),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(jobStatusGenerator, jobStatusGenerator), { maxLength: 8 }),
        async (attempts) => {
          const jobId = await submit();
          let expected: string = 'QUEUED';

          for (const [from, to] of attempts) {
            const wasTerminal = (TERMINAL_JOB_STATUSES as readonly string[]).includes(expected);

            if (!isAllowedTransition(from, to)) {
              await expect(service.transition(jobId, from, to, 'x', 'pbt')).rejects.toThrow();
            } else {
              const applied = await service.transition(jobId, from, to, 'x', 'pbt');
              expect(applied).toBe(from === expected);
              if (applied) {
                expect(wasTerminal).toBe(false);
                expected = to;
              }
            }

            const row = await context.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
            expect(row.status).toBe(expected);
          }

          const history = await context.prisma.jobStatusEvent.findMany({
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
            where: { jobId },
          });
          const path = history.map((event) => event.status);
          expect([
            'QUEUED',
            'QUEUED,RUNNING',
            'QUEUED,RUNNING,COMPLETED',
            'QUEUED,RUNNING,FAILED',
            'QUEUED,CANCELLED',
            'QUEUED,RUNNING,CANCELLED',
          ]).toContain(path.join(','));
        },
      ),
      { numRuns: DB_RUNS },
    );
  }, 120_000);

  it('P2 any number of submissions with one Idempotency-Key yields one job (US-005 AC3)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.integer({ min: 1, max: 4 }), async (key, repeats) => {
        const ids = [];

        for (let attempt = 0; attempt < repeats; attempt += 1) {
          ids.push(await submit(key));
        }

        expect(new Set(ids).size).toBe(1);
        expect(await context.prisma.job.count({ where: { idempotencyKey: key } })).toBe(1);
      }),
      { numRuns: DB_RUNS },
    );
  });

  it('P3 after deletion no row or file of the job remains (US-014 AC1–2)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 3 }), async (ticks) => {
        const jobId = await submit();

        for (let pass = 0; pass < ticks; pass += 1) {
          await context.tick();
        }

        expect((await owner.delete(`/api/v1/jobs/${jobId}`)).status).toBe(204);
        expect(await context.prisma.job.count({ where: { id: jobId } })).toBe(0);
        expect(await context.prisma.jobInput.count({ where: { jobId } })).toBe(0);
        expect(await context.prisma.jobStatusEvent.count({ where: { jobId } })).toBe(0);
        expect(context.jobDirectoryExists(jobId)).toBe(false);
      }),
      { numRuns: DB_RUNS },
    );
  });

  it('P4 a non-owner always gets 404 and never changes the job (US-002, US-006, US-007)', async () => {
    const jobId = await submit();
    const before = await context.prisma.job.findUniqueOrThrow({ where: { id: jobId } });

    await fc.assert(
      fc.asyncProperty(fc.constantFrom('GET', 'DELETE'), async (method) => {
        const response =
          method === 'GET'
            ? await intruder.get(`/api/v1/jobs/${jobId}`)
            : await intruder.delete(`/api/v1/jobs/${jobId}`);

        expect(response.status).toBe(404);
        expect(response.body.error.message).toBe('This job is unavailable.');
      }),
      { numRuns: DB_RUNS },
    );

    expect(await context.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).toEqual(before);
    expect((await intruder.get('/api/v1/jobs')).body.data.total).toBe(0);
  });

  it('P5 no client file name can move a write outside STORAGE_ROOT/jobs/{jobId} (US-004 AC4)', async () => {
    const storageRoot = join(context.config.storageRoot, 'p5');
    const storage = createJobStorage(storageRoot);
    const jobId = 'cpbtstorage00000000000000';

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.string({ maxLength: 40 }),
          fc.constantFrom(
            '../x.csv',
            '..\\x.csv',
            '/etc/passwd.csv',
            'C:\\x.csv',
            'A:',
            'a/../../b.csv',
          ),
        ),
        async (name) => {
          const result = validateInputFile(name, SAMPLE_BODY.file.content);

          if (result.ok) {
            // Accepted names are display metadata only; the write path ignores them entirely.
            await storage.writeInput(jobId, SAMPLE_BODY.file.content);
            expect(await readdir(join(storageRoot, 'jobs'))).toEqual([jobId]);
            expect(await readdir(join(storageRoot, 'jobs', jobId))).toEqual(['input.csv']);
          } else {
            expect(result.issues).toHaveLength(1);
          }

          // The path guard itself: any name either resolves inside the job directory or is refused.
          const directory = storage.jobDirectory(jobId);
          let resolved: string | null = null;
          try {
            resolved = resolvePrivateStoragePath(directory, name);
          } catch (error) {
            expect((error as Error).name).toBe('StoragePathError');
          }
          if (resolved !== null) {
            expect(resolved.startsWith(directory + sep)).toBe(true);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('P6 accepted CSV rows are always allowlisted and in range; audit never holds input values (US-004, US-015 AC2)', async () => {
    const markerArb = fc.constantFrom(...INPUT_MARKERS);
    const rowArb = fc.oneof(
      markerArb.chain((marker) =>
        fc
          .double({ max: marker.max * 1.5, min: 0, noNaN: true })
          .map((value) => `${marker.marker},${Number(value.toFixed(2))},${marker.unit}`),
      ),
      fc.string({ maxLength: 30 }),
    );

    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 12 }), (rows) => {
        const result = validateInputFile('input.csv', ['marker,value,unit', ...rows].join('\n'));

        if (result.ok) {
          expect(new Set(result.rows.map((row) => row.marker)).size).toBe(result.rows.length);

          for (const row of result.rows) {
            const marker = INPUT_MARKERS.find((item) => item.marker === row.marker);
            expect(marker).toBeDefined();
            expect(row.unit).toBe(marker?.unit);
            expect(row.value).toBeGreaterThanOrEqual(marker!.min);
            expect(row.value).toBeLessThanOrEqual(marker!.max);
          }
        }
      }),
      { numRuns: RUNS },
    );

    await fc.assert(
      fc.asyncProperty(idempotencyKeyGenerator, async (label) => {
        const safeLabel = label.replace(/[^A-Za-z0-9 _.-]/g, '').trim() || 'pbt';
        await owner.post(
          '/api/v1/jobs',
          {
            ...SAMPLE_BODY,
            parameters: { ...SAMPLE_BODY.parameters, sampleLabel: safeLabel.slice(0, 64) },
          },
          { 'Idempotency-Key': crypto.randomUUID() },
        );
      }),
      { numRuns: 10 },
    );

    const metadata = (await context.prisma.auditEvent.findMany())
      .map((row) => row.metadataJson)
      .join('\n');
    for (const marker of INPUT_MARKERS) {
      expect(metadata).not.toContain(marker.marker);
    }
    expect(metadata).not.toContain('marker,value,unit');
    expect(metadata).not.toContain('108');
  });
});
