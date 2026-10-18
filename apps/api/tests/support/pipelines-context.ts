import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { ClientRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { JobStatus } from '@portal/shared';

import { getJobWorker } from '../../src/http/app.js';
import { createJobStorage, type JobStorage } from '../../src/modules/jobs/job-storage.js';
import type { RunUploadLimits } from '../../src/modules/pipelines/run-upload.js';
import { createSession } from './http-session.js';
import {
  createIdentityTestContext,
  TEST_PASSWORD,
  type IdentityTestContext,
} from './identity-context.js';
import {
  buildMultipart,
  buildMultipartChunks,
  launchParts,
  waitForStagedFile,
  type LaunchSpec,
} from './multipart.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
export const FAKE_NEXTFLOW = join(FIXTURES, 'fake-nextflow.mjs');
export const FAKE_DOCKER = join(FIXTURES, 'fake-docker.mjs');
export const PIPELINE_ID = 'wf-renamefastq';
const POLL_MS = 25;

export type FakeScenario = 'success' | 'fail-step' | 'missing-output' | 'hang';
export type TestSession = ReturnType<typeof createSession> & { userId: string };

export type PipelinesTestContext = IdentityTestContext & {
  storage: JobStorage;
  /** `$TMPDIR/portal-fake-docker` of the fake tools (containers, call logs, knobs). */
  fakeStateDirectory: string;
  nextflowHome: string;
  signIn: (email: string) => Promise<TestSession>;
  tick: () => Promise<void>;
  worker: ReturnType<typeof getJobWorker>;
  launch: (
    session: TestSession,
    spec: LaunchSpec,
    options?: { idempotencyKey?: string; pipelineId?: string },
  ) => ReturnType<TestSession['postRaw']>;
  /**
   * Like `launch`, but streams the body part by part like a browser: each FASTQ part except
   * the last is sent only after the receiver opened its file. Avoids the BUG-1 race (a
   * rejection while an earlier file is still opening) so limit tests stay deterministic.
   */
  launchPaced: (
    session: TestSession,
    spec: LaunchSpec,
    options?: { idempotencyKey?: string },
  ) => Promise<{ status: number; body: { error?: { code: string; details: unknown[] } } }>;
  /** Writes `run/.scenario` before the worker starts the job (fake-nextflow reads it). */
  setScenario: (jobId: string, scenario: FakeScenario, delayMs?: number) => Promise<void>;
  /** Ticks the worker until the job reaches one of `statuses` (or the timeout passes). */
  waitForStatus: (
    jobId: string,
    statuses: readonly JobStatus[],
    timeoutMs?: number,
  ) => Promise<string>;
  /** Polls `GET /pipelines` until the Nextflow pipeline has a settled readiness result. */
  waitForReadiness: (session: TestSession, timeoutMs?: number) => Promise<PipelineState>;
  fakeContainers: () => Promise<{ id: string; name: string; workingDir: string }[]>;
  fakeCalls: (tool: 'docker' | 'nextflow') => Promise<string[][]>;
  /** True while a (fake) Nextflow process of the job is alive (`-name portal-<jobId>`). */
  processAlive: (jobId: string) => boolean;
  stagingEntries: () => Promise<string[]>;
};

export type PipelineState = { available: boolean; unavailableReason: string | null };

/**
 * Integration context for the pipeline catalog (design Testing Strategy): an isolated SQLite +
 * storage root, Nextflow enabled with `fake-nextflow.mjs` / `fake-docker.mjs` via
 * NEXTFLOW_BIN / DOCKER_BIN, an `NXF_HOME` with the registry plugin directory, and a private
 * `TMPDIR` so the fakes' shared state never crosses test files. No real Nextflow, Docker,
 * network or FASTQ data is used.
 */
export async function createPipelinesTestContext(
  options: {
    environment?: Record<string, string>;
    uploadLimits?: RunUploadLimits;
    /** Create `plugins/nf-validation-1.1.3` in NXF_HOME (default true). */
    withPlugin?: boolean;
    /** Fake-tool knobs written before the first readiness refresh. */
    fakeState?: { missingImages?: readonly string[]; unpulled?: boolean };
  } = {},
): Promise<PipelinesTestContext> {
  const originalTmpdir = process.env.TMPDIR;
  const sandbox = await mkdtemp(join(tmpdir(), 'portal-pipelines-it-'));
  const fakeTmp = join(sandbox, 'tmp');
  const nextflowHome = join(sandbox, 'nxf-home');
  const fakeStateDirectory = join(fakeTmp, 'portal-fake-docker');
  await mkdir(fakeStateDirectory, { recursive: true });
  await mkdir(nextflowHome, { recursive: true });

  if (options.withPlugin ?? true) {
    await mkdir(join(nextflowHome, 'plugins', 'nf-validation-1.1.3'), { recursive: true });
  }

  if (options.fakeState?.missingImages) {
    await writeFile(
      join(fakeStateDirectory, 'missing-images.txt'),
      `${options.fakeState.missingImages.join('\n')}\n`,
    );
  }

  if (options.fakeState?.unpulled) {
    await writeFile(join(fakeStateDirectory, 'unpulled'), '');
  }

  // The child-process allowlist passes TMPDIR, so the fakes keep their state in this sandbox.
  process.env.TMPDIR = fakeTmp;

  const context = await createIdentityTestContext(
    {
      AUTH_RATE_LIMIT_MAX: '10000',
      DOCKER_BIN: FAKE_DOCKER,
      EXECUTOR_ENABLED: 'false',
      EXECUTOR_QUEUED_DELAY_MS: '0',
      EXECUTOR_RUNNING_DELAY_MS: '0',
      NEXTFLOW_BIN: FAKE_NEXTFLOW,
      NEXTFLOW_CANCEL_GRACE_MS: '1000',
      NEXTFLOW_ENABLED: 'true',
      NEXTFLOW_HOME: nextflowHome,
      NEXTFLOW_MAX_CONCURRENT_RUNS: '1',
      NEXTFLOW_READINESS_INTERVAL_MS: '10000',
      SUBMIT_RATE_LIMIT_MAX: '10000',
      ...options.environment,
    },
    { isExecutorReady: () => true, runUploadLimits: options.uploadLimits },
  );
  const worker = getJobWorker(context.app);
  const storage = createJobStorage(context.config.storageRoot);

  async function readLines(path: string): Promise<string[][]> {
    const text = await readFile(path, 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  }

  return {
    ...context,
    cleanup: async () => {
      // Stops every fake run (SIGTERM → grace → SIGKILL) and the readiness interval.
      await worker.stop();
      // Rejections settle their staging removal asynchronously (after pending file tasks);
      // let it finish and remove uploads/ with retries so teardown never races it.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await rm(join(context.config.storageRoot, 'uploads'), {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 100,
      });
      await context.cleanup();

      if (originalTmpdir === undefined) {
        delete process.env.TMPDIR;
      } else {
        process.env.TMPDIR = originalTmpdir;
      }

      await rm(sandbox, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
    },
    fakeCalls: (tool) => readLines(join(fakeStateDirectory, `${tool}-calls.log`)),
    fakeContainers: async () => {
      const path = join(fakeStateDirectory, 'containers.json');
      return existsSync(path)
        ? (JSON.parse(await readFile(path, 'utf8')) as {
            id: string;
            name: string;
            workingDir: string;
          }[])
        : [];
    },
    fakeStateDirectory,
    launch: (session, spec, launchOptions = {}) => {
      const { body, contentType } = buildMultipart(launchParts(spec));
      return session.postRaw(
        `/api/v1/pipelines/${launchOptions.pipelineId ?? PIPELINE_ID}/runs`,
        body,
        {
          'Content-Type': contentType,
          'Idempotency-Key': launchOptions.idempotencyKey ?? crypto.randomUUID(),
        },
      );
    },
    launchPaced: async (session, spec, launchOptions = {}) => {
      const parts = launchParts(spec);
      const { chunks, contentType } = buildMultipartChunks(parts);
      const request = session.agent.post(`/api/v1/pipelines/${PIPELINE_ID}/runs`).set({
        'Content-Type': contentType,
        'Idempotency-Key': launchOptions.idempotencyKey ?? crypto.randomUUID(),
        'X-CSRF-Token': session.csrfToken(),
      });

      let responded = false;

      for (const [index, chunk] of chunks.entries()) {
        if (responded) {
          // The server already answered (a part was rejected): stop sending, as a browser does.
          break;
        }

        request.write(chunk);

        if (index === 0) {
          (request as unknown as { req: ClientRequest }).req.once('response', () => {
            responded = true;
          });
        }

        const part = parts[index];

        if (index < chunks.length - 1 && part && 'filename' in part && part.name === 'fastq') {
          await Promise.race([
            waitForStagedFile(context.config.storageRoot, part.filename),
            eventually(() => responded, 5000),
          ]);
        }
      }

      const response = await request;
      return { body: response.body as never, status: response.status };
    },
    nextflowHome,
    processAlive: (jobId) => {
      try {
        execFileSync('pgrep', ['-f', `portal-${jobId}`], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    },
    setScenario: async (jobId, scenario, delayMs = 100) => {
      const runDirectory = storage.jobSubdirectory(jobId, 'run');
      await mkdir(runDirectory, { mode: 0o700, recursive: true });
      await writeFile(join(runDirectory, '.scenario'), `${scenario} ${delayMs}\n`);
    },
    signIn: async (email) => {
      const { id } = await context.createUser(email, 'USER', { ready: true });
      const session = createSession(context.app);
      const response = await session.login(email, TEST_PASSWORD);

      if (response.status !== 200) {
        throw new Error(`Test login failed with ${response.status}`);
      }

      return { ...session, userId: id };
    },
    stagingEntries: async () => {
      const { readdir } = await import('node:fs/promises');
      return readdir(join(context.config.storageRoot, 'uploads')).catch(() => []);
    },
    storage,
    tick: () => worker.tick(),
    worker,
    waitForReadiness: async (session, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs;

      for (;;) {
        const response = await session.get('/api/v1/pipelines');
        const item = (response.body.data.items as ({ id: string } & PipelineState)[]).find(
          (pipeline) => pipeline.id === PIPELINE_ID,
        );
        const state = {
          available: Boolean(item?.available),
          unavailableReason: item?.unavailableReason ?? null,
        };

        if (state.available || state.unavailableReason !== null || Date.now() > deadline) {
          return state;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_MS * 4));
      }
    },
    waitForStatus: async (jobId, statuses, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;

      for (;;) {
        await worker.tick();
        const row = await context.prisma.job.findUnique({
          select: { status: true },
          where: { id: jobId },
        });
        const status = row?.status ?? 'DELETED';

        if ((statuses as readonly string[]).includes(status) || Date.now() > deadline) {
          return status;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    },
  };
}

/** Polls a condition (for background cancel/cleanup work) until it holds or times out. */
export async function eventually(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (await condition()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return condition();
}
