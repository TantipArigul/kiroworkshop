import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { mkdir, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';

import {
  classifyLayoutAs,
  renamefastqOptionsSchema,
  runInputLayoutSchema,
  type RenamefastqOptions,
  type RunInputLayout,
} from '@portal/shared';
import { z } from 'zod';

import type { NextflowConfig } from '../../config/config.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { resolvePrivateStoragePath } from '../../infrastructure/storage-path.js';
import type {
  ExecutionContext,
  ExecutorAdapter,
  ExecutorOutcome,
  PollResult,
  TransactionClient,
} from '../jobs/executor.js';
import type { JobStorage } from '../jobs/job-storage.js';
import { STATUS_SUMMARIES } from '../jobs/job.service.js';
import { buildProgress, failureSummary } from './nextflow-progress.js';
import {
  childEnvironment,
  createPipelineReadiness,
  offlineNextflowEnvironment,
  type PipelineReadinessState,
} from './readiness.js';
import {
  getPipelineDefinition,
  PIPELINE_REGISTRY,
  type NextflowParams,
  type NextflowPipelineSpec,
} from './registry.js';
import { FASTQ_DIRECTORY, SAMPLE_SHEET_FILE_NAME } from './run-input-validator.js';

/** Matches the defaults in `config.ts`; used when a caller passes only the core settings. */
export const NEXTFLOW_CONFIG_DEFAULTS: NextflowConfig = {
  dockerBin: 'docker',
  nextflowBin: 'nextflow',
  nextflowCancelGraceMs: 30_000,
  nextflowEnabled: false,
  nextflowHome: null,
  nextflowMaxConcurrentRuns: 1,
  nextflowMaxCpus: 4,
  nextflowMaxMemoryGb: 8,
  nextflowMaxTimeHours: 8,
  nextflowReadinessIntervalMs: 60_000,
};

export function resolveNextflowConfig(config: Partial<NextflowConfig>): NextflowConfig {
  return {
    ...NEXTFLOW_CONFIG_DEFAULTS,
    ...Object.fromEntries(
      Object.entries(config).filter(
        ([key, value]) => key in NEXTFLOW_CONFIG_DEFAULTS && value !== undefined,
      ),
    ),
  } as NextflowConfig;
}

const PARAMS_FILE = 'params.json';
const TRACE_FILE = 'trace.txt';
const STDOUT_FILE = 'nextflow.out.log';
const WORK_DIRECTORY = 'work';
const NEXTFLOW_STATE_DIRECTORY = '.nextflow';
/** Never created: points the pipeline's institutional-config includes at nothing (offline). */
export const NO_CUSTOM_CONFIG_DIRECTORY = 'no-custom-config';
const KILL_WAIT_MS = 5_000;
const GROUP_POLL_MS = 200;
const DOCKER_TIMEOUT_MS = 20_000;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{12,64}$/;

const runParametersSchema = z.object({
  layout: runInputLayoutSchema,
  options: renamefastqOptionsSchema,
  sampleName: z.string().nullable(),
});

type RunEntry = {
  child: ChildProcess;
  pid: number;
  startedAt: Date;
  exit: { code: number | null; signal: NodeJS.Signals | null } | null;
  exited: Promise<void>;
  cancelled: boolean;
  cancelling: Promise<void> | null;
};

type AdapterLogger = {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
};

type NextflowAdapterOptions = {
  config: NextflowConfig;
  prisma: PrismaClient;
  storage: JobStorage;
  logger: AdapterLogger;
  /** Output manifest writer run inside the COMPLETED transaction (C5 `recordOutputs`). */
  recordOutputs: (
    tx: TransactionClient,
    input: { jobId: string; requiredOutputs: readonly string[] },
  ) => Promise<void>;
};

export class NextflowUnavailableError extends Error {
  public constructor() {
    super('Nextflow runs are not enabled on this server.');
    this.name = 'NextflowUnavailableError';
  }
}

export class RunInputMissingError extends Error {
  public constructor() {
    super('The stored run input could not be read.');
    this.name = 'RunInputMissingError';
  }
}

export type NextflowAdapter = ExecutorAdapter & {
  /** Cached readiness of one Nextflow pipeline (no process is started by this call). */
  readiness(pipelineId: string): PipelineReadinessState;
  /** Runs the readiness checks now (tests; the background refresh runs on its own interval). */
  refreshReadiness(): Promise<void>;
};

/**
 * `params.json` of a job (C2 `buildParams` with the job's absolute paths). Shared with
 * `pipelines:check`, which verifies the offline-config guard on exactly this output.
 */
export function buildRunParams(input: {
  config: NextflowConfig;
  spec: NextflowPipelineSpec;
  storage: JobStorage;
  jobId: string;
  layout: RunInputLayout;
  sampleName: string | null;
  options: RenamefastqOptions;
  /** FASTQ file (SINGLE_FILE) or folder, relative to `input/fastq/`. */
  fastqRoot: string;
}): NextflowParams {
  const { config, storage } = input;
  const inputDirectory = storage.jobSubdirectory(input.jobId, 'input');
  const runDirectory = storage.jobSubdirectory(input.jobId, 'run');

  return input.spec.buildParams(
    {
      customConfigBase: join(runDirectory, NO_CUSTOM_CONFIG_DIRECTORY),
      fastqPath: resolvePrivateStoragePath(inputDirectory, `${FASTQ_DIRECTORY}/${input.fastqRoot}`),
      layout: input.layout,
      options: input.options,
      outdir: storage.jobSubdirectory(input.jobId, 'output'),
      sampleName: input.sampleName,
      sampleSheetPath:
        input.layout === 'BARCODE_FOLDERS'
          ? resolvePrivateStoragePath(inputDirectory, SAMPLE_SHEET_FILE_NAME)
          : null,
    },
    {
      maxCpus: config.nextflowMaxCpus,
      maxMemoryGb: config.nextflowMaxMemoryGb,
      maxTimeHours: config.nextflowMaxTimeHours,
    },
  );
}

/**
 * Local Nextflow executor (design C7). Each run is `nextflow run <repo> -r <revision>` spawned
 * without a shell as its own process group in `jobs/{id}/run`; user values reach Nextflow only
 * through `params.json` built from the registry allowlist, and the child environment is an
 * explicit allowlist. Runs are offline (`NXF_OFFLINE=true`).
 */
export function createNextflowAdapter(options: NextflowAdapterOptions): NextflowAdapter {
  const { config, logger, prisma, storage } = options;
  const runs = new Map<string, RunEntry>();
  const nextflowPipelines = PIPELINE_REGISTRY.filter((definition) => definition.nextflow);
  const nextflowPipelineIds = nextflowPipelines.map((definition) => definition.id);
  // Cached tooling/asset checks on their own interval; started only when Nextflow is enabled.
  const readinessMonitor = createPipelineReadiness({
    config,
    logger,
    pipelines: nextflowPipelines,
  });
  readinessMonitor.start();

  // ---------- public (port) ----------

  async function start(context: ExecutionContext): Promise<void> {
    if (!config.nextflowEnabled) {
      throw new NextflowUnavailableError();
    }

    const definition = getPipelineDefinition(context.pipelineId);
    const spec = definition?.nextflow;

    if (!spec) {
      throw new NextflowUnavailableError();
    }

    const job = await prisma.job.findUnique({
      select: {
        input: { select: { parametersJson: true } },
        inputFiles: { select: { kind: true, relativePath: true } },
      },
      where: { id: context.jobId },
    });
    const parameters = runParametersSchema.safeParse(_safeJson(job?.input?.parametersJson));

    if (!job || !parameters.success) {
      throw new RunInputMissingError();
    }

    const prefix = `${FASTQ_DIRECTORY}/`;
    const fastqPaths = job.inputFiles
      .filter((file) => file.kind === 'FASTQ' && file.relativePath.startsWith(prefix))
      .map((file) => file.relativePath.slice(prefix.length));
    const layout = classifyLayoutAs(parameters.data.layout, fastqPaths);

    if (!layout.ok) {
      throw new RunInputMissingError();
    }

    const runDirectory = storage.jobSubdirectory(context.jobId, 'run');
    const outputDirectory = storage.jobSubdirectory(context.jobId, 'output');
    const params = buildRunParams({
      config,
      fastqRoot:
        layout.layout === 'SINGLE_FILE' ? (layout.usedPaths[0] ?? '') : (layout.rootFolder ?? ''),
      jobId: context.jobId,
      layout: parameters.data.layout,
      options: parameters.data.options,
      sampleName: parameters.data.sampleName,
      spec,
      storage,
    });

    await mkdir(runDirectory, { mode: 0o700, recursive: true });
    await mkdir(outputDirectory, { mode: 0o700, recursive: true });
    await writeFile(join(runDirectory, PARAMS_FILE), JSON.stringify(params, null, 2), {
      mode: 0o600,
    });

    const log = await open(join(runDirectory, STDOUT_FILE), 'a', 0o600);
    let child: ChildProcess;

    try {
      child = spawn(
        config.nextflowBin,
        [
          'run',
          spec.repository,
          '-r',
          spec.revision,
          '-profile',
          spec.profiles.join(','),
          '-params-file',
          PARAMS_FILE,
          '-with-trace',
          TRACE_FILE,
          '-name',
          `portal-${context.jobId}`,
          '-ansi-log',
          'false',
        ],
        {
          cwd: runDirectory,
          detached: true,
          env: offlineNextflowEnvironment(config, spec),
          shell: false,
          stdio: ['ignore', log.fd, log.fd],
        },
      );
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', () => resolve());
        child.once('error', reject);
      });
      child.on('error', (error) => {
        logger.error({ errorType: error.name, jobId: context.jobId }, 'Nextflow process error');
      });
    } finally {
      // The child holds its own copy of the descriptor.
      await log.close();
    }

    const pid = child.pid;

    if (pid === undefined) {
      throw new NextflowUnavailableError();
    }

    const entry: RunEntry = {
      cancelled: false,
      cancelling: null,
      child,
      exit: null,
      exited: Promise.resolve(),
      pid,
      startedAt: new Date(),
    };
    entry.exited = new Promise<void>((resolve) => {
      child.once('exit', (code, signal) => {
        entry.exit = { code, signal };
        logger.info(
          {
            durationMs: Date.now() - entry.startedAt.getTime(),
            exitCode: code,
            jobId: context.jobId,
            signal,
          },
          'Nextflow run exited',
        );
        resolve();
      });
    });
    runs.set(context.jobId, entry);
    logger.info({ jobId: context.jobId, revision: spec.revision }, 'Nextflow run started');
  }

  async function poll(context: ExecutionContext): Promise<PollResult> {
    const entry = runs.get(context.jobId);

    if (!entry) {
      // No process in this API instance (e.g. after a restart): never reattached.
      return { state: 'failed', summary: STATUS_SUMMARIES.INTERRUPTED };
    }

    const runDirectory = storage.jobSubdirectory(context.jobId, 'run');
    const trace = await _readText(join(runDirectory, TRACE_FILE));

    if (!entry.exit) {
      const stdout = await _readText(join(runDirectory, STDOUT_FILE));
      return { progress: buildProgress(trace, stdout, entry.startedAt), state: 'running' };
    }

    if (entry.exit.code === 0 && !entry.cancelled) {
      const requiredOutputs =
        getPipelineDefinition(context.pipelineId)?.nextflow?.requiredOutputs ?? [];

      return {
        finalize: (tx) => options.recordOutputs(tx, { jobId: context.jobId, requiredOutputs }),
        state: 'succeeded',
      };
    }

    return { state: 'failed', summary: failureSummary(trace) };
  }

  /** SIGTERM the process group → wait the grace period → SIGKILL → remove leftover containers. */
  async function cancel(jobId: string): Promise<void> {
    const entry = runs.get(jobId);

    if (!entry) {
      await _removeContainers(jobId);
      return;
    }

    entry.cancelled = true;
    entry.cancelling ??= (async () => {
      if (_groupAlive(entry.pid)) {
        _signalGroup(jobId, entry.pid, 'SIGTERM');

        if (!(await _waitGroupGone(entry.pid, config.nextflowCancelGraceMs))) {
          _signalGroup(jobId, entry.pid, 'SIGKILL');
          await _waitGroupGone(entry.pid, KILL_WAIT_MS);
        }
      }

      await entry.exited;
      await _removeContainers(jobId);
    })();

    return entry.cancelling;
  }

  /** Removes `run/work` and `run/.nextflow`; partial `output/` too unless COMPLETED. */
  async function cleanup(jobId: string, outcome: ExecutorOutcome): Promise<void> {
    const entry = runs.get(jobId);

    if (entry && !entry.exit) {
      await cancel(jobId);
    }

    runs.delete(jobId);

    try {
      const runDirectory = storage.jobSubdirectory(jobId, 'run');
      await rm(join(runDirectory, WORK_DIRECTORY), { force: true, recursive: true });
      await rm(join(runDirectory, NEXTFLOW_STATE_DIRECTORY), { force: true, recursive: true });

      if (outcome !== 'COMPLETED') {
        await rm(storage.jobSubdirectory(jobId, 'output'), { force: true, recursive: true });
      }
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : 'unknown', jobId },
        'Nextflow cleanup failed',
      );
    }
  }

  /** Shutdown (D3-15): SIGTERM every active run, then SIGKILL and container removal at timeout. */
  async function stopAll(timeoutMs: number): Promise<void> {
    readinessMonitor.stop();
    const active = [...runs.entries()].filter(([, entry]) => !entry.exit);

    for (const [jobId, entry] of active) {
      entry.cancelled = true;
      _signalGroup(jobId, entry.pid, 'SIGTERM');
    }

    await Promise.all(
      active.map(async ([jobId, entry]) => {
        if (!(await _waitGroupGone(entry.pid, timeoutMs))) {
          _signalGroup(jobId, entry.pid, 'SIGKILL');
          await _waitGroupGone(entry.pid, KILL_WAIT_MS);
        }

        await _removeContainers(jobId);
      }),
    );
  }

  function readiness(pipelineId: string): PipelineReadinessState {
    return readinessMonitor.state(pipelineId);
  }

  // ---------- private ----------

  function _signalGroup(jobId: string, pid: number, signal: NodeJS.Signals) {
    try {
      process.kill(-pid, signal);
      logger.info({ jobId, signal }, 'Nextflow run signalled');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        logger.error({ errorType: (error as Error).name, jobId }, 'Nextflow signal failed');
      }
    }
  }

  function _groupAlive(pid: number): boolean {
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  async function _waitGroupGone(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (_groupAlive(pid)) {
      if (Date.now() >= deadline) {
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, GROUP_POLL_MS));
    }

    return true;
  }

  /**
   * Spike 1.1 OQ2: containers are named `nxf-<random>` without a run label, and the bind mount
   * is too wide to filter by volume. Only containers whose working directory is inside this
   * job's `run/work/` are removed — never anything else.
   */
  async function _removeContainers(jobId: string): Promise<void> {
    try {
      const runDirectory = storage.jobSubdirectory(jobId, 'run');
      // Nextflow reports the working directory from getcwd(), i.e. with symlinks resolved.
      const resolvedRun = await realpath(runDirectory).catch(() => runDirectory);
      const workPrefixes = [
        ...new Set(
          [runDirectory, resolvedRun].map((path) => `${join(path, WORK_DIRECTORY)}${sep}`),
        ),
      ];
      const listed = await _docker(['ps', '-q', '--filter', 'name=nxf-']);
      const ids = listed.stdout.split(/\s+/).filter((id) => CONTAINER_ID_PATTERN.test(id));

      if (ids.length === 0) {
        return;
      }

      // Containers that exit between `ps` and `inspect` make inspect exit 1 with partial output.
      const inspected = await _docker([
        'inspect',
        '--format',
        '{{.Id}} {{.Config.WorkingDir}}',
        ...ids,
      ]);
      const matched = inspected.stdout.split('\n').flatMap((line) => {
        const space = line.indexOf(' ');
        const id = line.slice(0, space);
        const workingDirectory = line.slice(space + 1).trim();

        return space > 0 &&
          CONTAINER_ID_PATTERN.test(id) &&
          workPrefixes.some((prefix) => workingDirectory.startsWith(prefix))
          ? [id]
          : [];
      });

      if (matched.length > 0) {
        await _docker(['rm', '-f', ...matched]);
        logger.info({ count: matched.length, jobId }, 'Removed run containers');
      }
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : 'unknown', jobId },
        'Nextflow container cleanup failed',
      );
    }
  }

  function _docker(args: string[]): Promise<{ code: number; stdout: string }> {
    return new Promise((resolve, reject) => {
      execFile(
        config.dockerBin,
        args,
        {
          encoding: 'utf8',
          env: childEnvironment(config, {}, false),
          maxBuffer: 1_048_576,
          shell: false,
          timeout: DOCKER_TIMEOUT_MS,
        },
        (error, stdout) => {
          if (error && typeof error.code !== 'number') {
            reject(error);
            return;
          }

          resolve({ code: error ? Number(error.code) : 0, stdout: String(stdout) });
        },
      );
    });
  }

  return {
    cancel,
    capacity: config.nextflowMaxConcurrentRuns,
    cleanup,
    id: 'nextflow',
    isReady: () => nextflowPipelineIds.every((pipelineId) => readiness(pipelineId).ready),
    poll,
    readiness,
    refreshReadiness: () => readinessMonitor.refresh(),
    start,
    stopAll,
  };
}

async function _readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function _safeJson(value: string | undefined): unknown {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
