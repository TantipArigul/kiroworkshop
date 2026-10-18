import { readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  classifyLayout,
  classifyLayoutAs,
  isFastqFileName,
  isSafePathSegment,
  isValidSampleName,
  matchSheetToFolders,
  RUN_INPUT_LAYOUTS,
  splitRelativePath,
  type RunInputLayout,
} from '@portal/shared';

import {
  relativePathSetGenerator,
  renamefastqOptionsGenerator,
  runInputLayoutGenerator,
  sampleNameGenerator,
  sampleSheetFor,
  sheetFolderBarcodesGenerator,
  unsafePathGenerator,
  uploadViolationGenerator,
  type UploadViolation,
} from '../../../../packages/shared/src/testing/generators.js';
import { resolvePrivateStoragePath } from '../../src/infrastructure/storage-path.js';
import { createAuditService } from '../../src/modules/audit/audit.service.js';
import { createExecutorDirectory, type ExecutorAdapter } from '../../src/modules/jobs/executor.js';
import { createJobWorker } from '../../src/modules/jobs/job-worker.js';
import { createJobService } from '../../src/modules/jobs/job.service.js';
import {
  buildRunParams,
  NEXTFLOW_CONFIG_DEFAULTS,
} from '../../src/modules/pipelines/nextflow-adapter.js';
import {
  getPipelineDefinition,
  RENAMEFASTQ_PARAM_KEYS,
} from '../../src/modules/pipelines/registry.js';
import { validateLaunch } from '../../src/modules/pipelines/run-input-validator.js';
import { syntheticFastq, type LaunchSpec } from '../support/multipart.js';
import {
  createPipelinesTestContext,
  type PipelinesTestContext,
  type TestSession,
} from '../support/pipelines-context.js';

/** Same convention as job-lifecycle.test.ts: fast-check's default for pure properties, fewer DB runs. */
const RUNS = 100;
const DB_RUNS = 25;
/** DB/HTTP properties share the machine with the parallel suite; 5 s is not enough there. */
const DB_PROPERTY_TIMEOUT_MS = 120_000;
const LIMITS = { maxFastqFiles: 3, maxTotalBytes: 2048, sampleSheetMaxBytes: 512 };
const JOB_ID = 'cpbtpipelinerun0000000000';
const UNSAFE_CHARACTERS = [' ', '\t', '\n', '"', "'", '`', '$', ';', '|', '/', '\\', '&', '<', '>'];

let context: PipelinesTestContext;
let owner: TestSession;

beforeAll(async () => {
  context = await createPipelinesTestContext({ uploadLimits: LIMITS });
  owner = await context.signIn('pbt-pipelines@example.test');
  expect((await context.waitForReadiness(owner)).available).toBe(true);
}, 60_000);

afterAll(async () => {
  await context.cleanup();
});

/**
 * Independent reference model of the pipeline's `determineInputType` plus the portal's
 * stricter rules (C4): one top-level file; files directly in one folder (unclassified/
 * ignored); or files in barcode sub-folders of one folder. Anything mixed or deeper is null.
 */
function referenceLayout(
  paths: readonly string[],
): { layout: RunInputLayout; barcodes: string[] } | null {
  const split = paths.map((path) => path.split('/'));

  if (split.some((segments) => segments.length > 3)) {
    return null;
  }

  const topLevel = split.filter((segments) => segments.length === 1);

  if (topLevel.length > 0) {
    return split.length === 1 ? { barcodes: [], layout: 'SINGLE_FILE' } : null;
  }

  if (new Set(split.map((segments) => segments[0])).size !== 1) {
    return null;
  }

  const direct = split.filter((segments) => segments.length === 2);
  const barcoded = split.filter(
    (segments) => segments.length === 3 && segments[1] !== 'unclassified',
  );

  if (direct.length > 0) {
    return barcoded.length > 0 ? null : { barcodes: [], layout: 'SAMPLE_FOLDER' };
  }

  if (barcoded.length === 0) {
    return null;
  }

  const barcodes = [...new Set(barcoded.map((segments) => segments[1] ?? ''))].sort();
  return barcodes.every((name) => /^barcode\d{2,}$/.test(name))
    ? { barcodes, layout: 'BARCODE_FOLDERS' }
    : null;
}

function launchFields(layout: RunInputLayout) {
  return { layout, options: '{}', runName: 'Property run' };
}

describe('Pipeline run properties (fast-check)', () => {
  it('P8 classifyLayout matches the reference model and rejects mixes and deep nesting (US-018 AC3)', () => {
    fc.assert(
      fc.property(relativePathSetGenerator, (paths) => {
        const expected = referenceLayout(paths);
        const actual = classifyLayout(paths);

        expect(actual.ok).toBe(expected !== null);

        if (actual.ok && expected) {
          expect(actual.layout).toBe(expected.layout);
          expect(actual.barcodes).toEqual(expected.barcodes);
        }

        for (const layout of RUN_INPUT_LAYOUTS) {
          const chosen = classifyLayoutAs(layout, paths);
          expect(chosen.ok).toBe(expected?.layout === layout);

          // The API validator (C4) accepts the files exactly when the shared rule does.
          const validated = validateLaunch({
            fastqFiles: paths.map((relativePath) => ({ relativePath, sizeBytes: 1 })),
            fields: launchFields(layout),
            sampleSheet:
              layout === 'BARCODE_FOLDERS'
                ? { content: sampleSheetFor(expected?.barcodes ?? ['barcode01']), sizeBytes: 1 }
                : null,
          });
          const filesRejected =
            !validated.ok && validated.issues.some((issue) => issue.field === 'files');
          expect(filesRejected).toBe(expected?.layout !== layout);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('P9 the sheet matches iff its barcode set equals the barcode sub-folder set (US-018 AC4)', () => {
    fc.assert(
      fc.property(
        sheetFolderBarcodesGenerator,
        fc.boolean(),
        ({ folders, sheet }, unclassified) => {
          const equal =
            new Set(sheet).size === new Set(folders).size &&
            sheet.every((barcode) => folders.includes(barcode));
          const folderNames = unclassified ? [...folders, 'unclassified'] : folders;

          expect(matchSheetToFolders(sheet, folderNames).ok).toBe(equal);

          const validated = validateLaunch({
            fastqFiles: folderNames.map((name) => ({
              relativePath: `run/${name}/reads.fastq.gz`,
              sizeBytes: 1,
            })),
            fields: launchFields('BARCODE_FOLDERS'),
            sampleSheet: { content: sampleSheetFor(sheet), sizeBytes: 1 },
          });

          expect(validated.ok).toBe(equal);
          if (!validated.ok) {
            expect(validated.issues.map((issue) => issue.code)).toEqual(['SHEET_MISMATCH']);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('P10 accepted names are shell-safe and accepted paths resolve inside the job directory (US-018 AC2, AC5)', () => {
    const storage = context.storage;
    const jobDirectory = storage.jobDirectory(JOB_ID);
    const inputDirectory = storage.jobSubdirectory(JOB_ID, 'input');

    fc.assert(
      fc.property(fc.oneof(sampleNameGenerator, fc.string({ maxLength: 70 })), (name) => {
        if (isValidSampleName(name)) {
          expect(/\s/.test(name)).toBe(false);
          expect(UNSAFE_CHARACTERS.some((char) => name.includes(char))).toBe(false);
          expect(name.includes('..')).toBe(false);
        }
      }),
      { numRuns: RUNS },
    );

    fc.assert(
      fc.property(
        fc.oneof(
          unsafePathGenerator,
          relativePathSetGenerator.map((paths) => paths[0] ?? ''),
        ),
        (path) => {
          const segments = splitRelativePath(path);

          if (segments) {
            for (const segment of segments) {
              expect(isSafePathSegment(segment)).toBe(true);
              expect(segment.includes('..')).toBe(false);
              expect(segment.startsWith('.')).toBe(false);
              expect(UNSAFE_CHARACTERS.some((char) => segment.includes(char))).toBe(false);
            }

            const resolved = resolvePrivateStoragePath(inputDirectory, `fastq/${path}`);
            expect(resolved.startsWith(`${jobDirectory}${sep}`)).toBe(true);
          }

          // The guard itself: any string either resolves inside the job directory or throws.
          let resolved: string | null = null;
          try {
            resolved = resolvePrivateStoragePath(inputDirectory, `fastq/${path}`);
          } catch (error) {
            expect((error as Error).name).toBe('StoragePathError');
          }
          if (resolved !== null) {
            expect(resolved.startsWith(`${jobDirectory}${sep}`)).toBe(true);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it(
    'P11 over-limit or unsafe uploads leave no Job/JobInputFile row and no uploads/ or jobs/ directory (US-018 AC1, AC6; paced client)',
    async () => {
      const jobsDirectory = join(context.config.storageRoot, 'jobs');

      function specFor(violation: UploadViolation): LaunchSpec {
        const base = Array.from(
          { length: LIMITS.maxFastqFiles },
          (_, index) => `run/r${index}.fastq`,
        );

        switch (violation.kind) {
          case 'TOO_MANY_FILES':
            return {
              files: [
                ...base,
                ...Array.from(
                  { length: violation.extraFiles },
                  (_, index) => `run/x${index}.fastq`,
                ),
              ],
              layout: 'SAMPLE_FOLDER',
            };
          case 'TOO_LARGE': {
            // Up to 3 files, each within the per-file limit, whose total exceeds the limit.
            const total = LIMITS.maxTotalBytes + violation.extraBytes;
            const size = Math.ceil(total / LIMITS.maxFastqFiles);
            return {
              files: Array.from({ length: LIMITS.maxFastqFiles }, (_, index) => ({
                content: `@${'A'.repeat(size - 1)}`,
                path: `run/big${index}.fastq`,
              })),
              layout: 'SAMPLE_FOLDER',
            };
          }
          default: {
            const files: LaunchSpec['files'] = ['run/r0.fastq', 'run/r1.fastq'];
            const withUnsafe = [...files];
            withUnsafe.splice(violation.position, 0, {
              content: syntheticFastq(),
              path: violation.path,
            });
            return { files: withUnsafe, layout: 'SAMPLE_FOLDER' };
          }
        }
      }

      await fc.assert(
        fc.asyncProperty(uploadViolationGenerator, async (violation) => {
          const jobsBefore = await context.prisma.job.count();
          const filesBefore = await context.prisma.jobInputFile.count();
          const directoriesBefore = await readdir(jobsDirectory).catch(() => []);

          const response = await context.launchPaced(owner, specFor(violation));

          expect(response.status).toBe(400);
          expect(response.body.error.code).toBe('VALIDATION_FAILED');
          expect(await context.prisma.job.count()).toBe(jobsBefore);
          expect(await context.prisma.jobInputFile.count()).toBe(filesBefore);
          expect(await readdir(jobsDirectory).catch(() => [])).toEqual(directoriesBefore);

          expect(await context.stagingEntries()).toEqual([]);
        }),
        { numRuns: DB_RUNS },
      );
    },
    DB_PROPERTY_TIMEOUT_MS,
  );

  // The same property with the whole body sent at once (no pacing). It exposed BUG-1/BUG-1b
  // (counterexample [{"extraFiles":1,"kind":"TOO_MANY_FILES"}]); regression tests for both are
  // in tests/unit/pipelines/run-upload.test.ts.
  it(
    'P11 (unpaced client) over-limit or unsafe uploads leave no row and no uploads/ or jobs/ directory',
    async () => {
      const jobsDirectory = join(context.config.storageRoot, 'jobs');

      function specFor(violation: UploadViolation): LaunchSpec {
        const base = Array.from(
          { length: LIMITS.maxFastqFiles },
          (_, index) => `run/r${index}.fastq`,
        );

        switch (violation.kind) {
          case 'TOO_MANY_FILES':
            return {
              files: [
                ...base,
                ...Array.from(
                  { length: violation.extraFiles },
                  (_, index) => `run/x${index}.fastq`,
                ),
              ],
              layout: 'SAMPLE_FOLDER',
            };
          case 'TOO_LARGE': {
            const length = LIMITS.maxTotalBytes + violation.extraBytes;
            const content = `@r\n${'A'.repeat(length)}\n+\n${'I'.repeat(length)}\n`;
            return { files: [{ content, path: 'run/big.fastq' }], layout: 'SAMPLE_FOLDER' };
          }
          default: {
            const files: LaunchSpec['files'] = ['run/r0.fastq', 'run/r1.fastq'];
            const withUnsafe = [...files];
            withUnsafe.splice(violation.position, 0, {
              content: syntheticFastq(),
              path: violation.path,
            });
            return { files: withUnsafe, layout: 'SAMPLE_FOLDER' };
          }
        }
      }

      await fc.assert(
        fc.asyncProperty(uploadViolationGenerator, async (violation) => {
          const jobsBefore = await context.prisma.job.count();
          const filesBefore = await context.prisma.jobInputFile.count();
          const directoriesBefore = await readdir(jobsDirectory).catch(() => []);

          const response = await context.launch(owner, specFor(violation));

          expect(response.status).toBe(400);
          expect(response.body.error.code).toBe('VALIDATION_FAILED');
          expect(await context.prisma.job.count()).toBe(jobsBefore);
          expect(await context.prisma.jobInputFile.count()).toBe(filesBefore);
          expect(await readdir(jobsDirectory).catch(() => [])).toEqual(directoriesBefore);

          expect(await context.stagingEntries()).toEqual([]);
        }),
        { numRuns: DB_RUNS },
      );
    },
    DB_PROPERTY_TIMEOUT_MS,
  );

  it(
    'P11a (unpaced client, arbitrary paths) uploads rejected before any FASTQ stream opens leave no row and no uploads/ or jobs/ directory (US-018 AC2, AC6)',
    async () => {
      const jobsDirectory = join(context.config.storageRoot, 'jobs');
      // Rejected by the receiver's pre-stream checks for SAMPLE_FOLDER: unsafe segment, depth
      // other than 2 or a non-FASTQ name — so no write stream was ever started.
      const rejectedBeforeStream = (path: string) => {
        const segments = splitRelativePath(path);
        return !segments || segments.length !== 2 || !isFastqFileName(segments.at(-1) ?? '');
      };
      const firstPathGenerator = fc
        .oneof(
          unsafePathGenerator,
          relativePathSetGenerator.chain((paths) => fc.constantFrom(...paths)),
        )
        // The hand-built multipart header does not quoted-string-escape the filename, so CR/LF,
        // `"` and `\` would corrupt the header itself (busboy then drops the whole part — seen
        // with the counterexample "\"). Those characters are covered by P10 and the unit tests.
        .filter((path) => !/[\r\n"\\]/.test(path) && rejectedBeforeStream(path));

      await fc.assert(
        fc.asyncProperty(firstPathGenerator, async (path) => {
          const jobsBefore = await context.prisma.job.count();
          const filesBefore = await context.prisma.jobInputFile.count();
          const directoriesBefore = await readdir(jobsDirectory).catch(() => []);

          const response = await context.launch(owner, {
            files: [{ content: syntheticFastq(), path }, 'run/r1.fastq'],
            layout: 'SAMPLE_FOLDER',
          });

          expect(response.status).toBe(400);
          expect(response.body.error.code).toBe('VALIDATION_FAILED');
          expect(await context.prisma.job.count()).toBe(jobsBefore);
          expect(await context.prisma.jobInputFile.count()).toBe(filesBefore);
          expect(await context.stagingEntries()).toEqual([]);
          expect(await readdir(jobsDirectory).catch(() => [])).toEqual(directoriesBefore);
        }),
        { numRuns: DB_RUNS },
      );
    },
    DB_PROPERTY_TIMEOUT_MS,
  );

  it('P12 params.json holds only allowlisted keys with the declared types (US-019 AC1, AC3)', () => {
    const spec = getPipelineDefinition('wf-renamefastq')?.nextflow;
    const storage = context.storage;
    const jobDirectory = storage.jobDirectory(JOB_ID);
    const types: Record<(typeof RENAMEFASTQ_PARAM_KEYS)[number], 'string' | 'number' | 'boolean'> =
      {
        custom_config_base: 'string',
        demultiplex: 'boolean',
        fastq: 'string',
        kit_name: 'string',
        max_cpus: 'number',
        max_memory: 'string',
        max_time: 'string',
        monochrome_logs: 'boolean',
        outdir: 'string',
        q_score: 'number',
        quality_filter: 'boolean',
        sample: 'string',
        sample_sheet: 'string',
        validate_params: 'boolean',
      };

    fc.assert(
      fc.property(
        runInputLayoutGenerator,
        fc.option(sampleNameGenerator, { nil: null }),
        renamefastqOptionsGenerator,
        fc.record({
          maxCpus: fc.integer({ max: 16, min: 1 }),
          maxMemoryGb: fc.integer({ max: 64, min: 2 }),
          maxTimeHours: fc.integer({ max: 48, min: 1 }),
        }),
        relativePathSetGenerator,
        (layout, sampleName, options, caps, paths) => {
          const fastqRoot = (paths[0] ?? 'r.fastq').split('/')[0] ?? 'r.fastq';
          const params = buildRunParams({
            config: {
              ...NEXTFLOW_CONFIG_DEFAULTS,
              nextflowMaxCpus: caps.maxCpus,
              nextflowMaxMemoryGb: caps.maxMemoryGb,
              nextflowMaxTimeHours: caps.maxTimeHours,
            },
            fastqRoot,
            jobId: JOB_ID,
            layout,
            options,
            sampleName,
            spec: spec!,
            storage,
          });
          const keys = Object.keys(params);

          for (const key of keys) {
            expect(RENAMEFASTQ_PARAM_KEYS as readonly string[]).toContain(key);
            expect(typeof params[key]).toBe(types[key as keyof typeof types]);
          }

          expect(keys.includes('sample_sheet')).toBe(layout === 'BARCODE_FOLDERS');
          expect(keys.includes('sample')).toBe(layout !== 'BARCODE_FOLDERS' && sampleName !== null);
          expect(keys.includes('kit_name')).toBe(options.demultiplex);
          expect(Number.isInteger(params.q_score) && Number.isInteger(params.max_cpus)).toBe(true);

          for (const key of ['fastq', 'outdir', 'custom_config_base', 'sample_sheet'] as const) {
            if (key in params) {
              expect(String(params[key]).startsWith(`${jobDirectory}${sep}`)).toBe(true);
            }
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  it(
    'P13 no worker tick exceeds NEXTFLOW_MAX_CONCURRENT_RUNS and runs start oldest-first by createdAt (US-019 AC2)',
    async () => {
      const user = await context.createUser('pbt-queue@example.test', 'USER', { ready: true });
      const audit = createAuditService(context.prisma, { error: () => undefined });
      const logger = { error: () => undefined, info: () => undefined };
      let startedTotal = 0;
      const actionGenerator = fc.oneof(
        { arbitrary: fc.constant({ kind: 'tick' as const }), weight: 4 },
        {
          arbitrary: fc.nat({ max: 7 }).map((index) => ({ index, kind: 'cancel' as const })),
          weight: 1,
        },
      );

      await fc.assert(
        fc.asyncProperty(
          fc.integer({ max: 4, min: 1 }),
          fc.array(fc.integer({ max: 60_000, min: 0 }), { maxLength: 8, minLength: 1 }),
          fc.array(fc.constantFrom('running', 'succeeded', 'failed'), {
            maxLength: 12,
            minLength: 1,
          }),
          fc.array(actionGenerator, { maxLength: 12, minLength: 1 }),
          async (capacity, ageOffsets, outcomes, actions) => {
            await context.prisma.job.deleteMany({ where: { pipelineId: 'wf-renamefastq' } });
            const now = Date.now();
            const jobs = [];

            for (const offset of ageOffsets) {
              jobs.push(
                await context.prisma.job.create({
                  data: {
                    createdAt: new Date(now - 120_000 + offset),
                    expiresAt: new Date(now + 86_400_000),
                    ownerId: user.id,
                    pipelineId: 'wf-renamefastq',
                    pipelineRevision: '1.0.3',
                    runName: 'Queue property',
                    status: 'QUEUED',
                  },
                }),
              );
            }

            const violations: string[] = [];
            let polls = 0;
            const adapter: ExecutorAdapter = {
              cancel: async () => undefined,
              capacity,
              cleanup: async () => undefined,
              id: 'nextflow',
              isReady: () => true,
              poll: async () => {
                const outcome = outcomes[polls % outcomes.length];
                polls += 1;
                return outcome === 'failed'
                  ? { state: 'failed', summary: 'Synthetic failure.' }
                  : { state: outcome === 'succeeded' ? 'succeeded' : 'running' };
              },
              start: async (startContext) => {
                startedTotal += 1;
                const self = jobs.find((job) => job.id === startContext.jobId)!;
                const running = await context.prisma.job.count({
                  where: { pipelineId: 'wf-renamefastq', status: 'RUNNING' },
                });
                const olderQueued = await context.prisma.job.count({
                  where: {
                    OR: [
                      { createdAt: { lt: self.createdAt } },
                      { createdAt: self.createdAt, id: { lt: self.id } },
                    ],
                    pipelineId: 'wf-renamefastq',
                    status: 'QUEUED',
                  },
                });

                if (running > capacity) {
                  violations.push(`capacity ${running}/${capacity}`);
                }

                if (olderQueued > 0) {
                  violations.push(`started ${self.id} before ${olderQueued} older queued job(s)`);
                }
              },
              stopAll: async () => undefined,
            };
            const executors = createExecutorDirectory([
              { adapter, pipelineIds: ['wf-renamefastq'] },
            ]);
            const service = createJobService({
              audit,
              config: context.config,
              executors,
              isExecutorReady: () => true,
              logger,
              prisma: context.prisma,
              storage: context.storage,
            });
            const worker = createJobWorker({
              config: { ...context.config, executorQueuedDelayMs: 0 },
              executors,
              jobs: service,
              logger,
              prisma: context.prisma,
              storage: context.storage,
            });

            for (const action of actions) {
              if (action.kind === 'tick') {
                await worker.tick();
              } else {
                const target = jobs[action.index % jobs.length]!;
                const row = await context.prisma.job.findUniqueOrThrow({
                  where: { id: target.id },
                });

                if (row.status === 'QUEUED' || row.status === 'RUNNING') {
                  await service.transition(target.id, row.status, 'CANCELLED', 'pbt', 'pbt');
                }
              }

              const running = await context.prisma.job.count({
                where: { pipelineId: 'wf-renamefastq', status: 'RUNNING' },
              });
              expect(running).toBeLessThanOrEqual(capacity);
            }

            expect(violations).toEqual([]);
          },
        ),
        { numRuns: DB_RUNS },
      );

      // Non-vacuous: the generated schedules really started runs.
      expect(startedTotal).toBeGreaterThan(0);
      await context.prisma.job.deleteMany({ where: { pipelineId: 'wf-renamefastq' } });
    },
    DB_PROPERTY_TIMEOUT_MS,
  );
});
