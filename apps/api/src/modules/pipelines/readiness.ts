import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PipelineUnavailableReason } from '@portal/shared';

import type { NextflowConfig } from '../../config/config.js';
import type { NextflowPipelineSpec, PipelineDefinition } from './registry.js';

/** Upper bound of every readiness tool call, so a hung tool never blocks a refresh for long. */
export const TOOL_TIMEOUT_MS = 20_000;
/** Inherited from the API process only when set; nothing else (no portal secrets) is passed. */
const INHERITED_ENV = ['PATH', 'HOME', 'JAVA_HOME', 'TMPDIR', 'LANG'] as const;
/** Environment of every offline Nextflow call (runs, readiness and `pipelines:check`). */
export const FIXED_NEXTFLOW_ENV = {
  NXF_DISABLE_CHECK_LATEST: 'true',
  NXF_OFFLINE: 'true',
  NXF_OPTS: '-Xms512m -Xmx2g',
} as const;
const TOOL_MAX_BUFFER_BYTES = 4 * 1_048_576;

export type ToolResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  /** Captured for the CLI only (e.g. a registry error of `docker pull`); never logged. */
  stderr: string;
  timedOut: boolean;
};

export type ReadinessCheck = {
  /** Stable label, e.g. `nextflow`, `docker`, `image <ref>`, `pipeline <repo>@<revision>`. */
  name: string;
  ok: boolean;
  /** Reason code reported by the catalog when this check fails. */
  reason: PipelineUnavailableReason;
  /** Safe, short detail (version, digest); never a storage path or environment value. */
  detail: string;
};

export type PipelineReadinessState = {
  ready: boolean;
  reason: PipelineUnavailableReason | null;
};

type ReadinessLogger = {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
};

/**
 * Child environment allowlist (design C7): only `PATH`, `HOME`, `JAVA_HOME`, `TMPDIR`, `LANG`,
 * optionally `NXF_HOME`, plus the fixed values in `extra`.
 */
export function childEnvironment(
  config: Pick<NextflowConfig, 'nextflowHome'>,
  extra: Record<string, string>,
  withNextflowHome: boolean,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const key of INHERITED_ENV) {
    const value = process.env[key];

    if (value) {
      environment[key] = value;
    }
  }

  const nextflowHome = config.nextflowHome ?? process.env.NXF_HOME;

  if (withNextflowHome && nextflowHome) {
    environment.NXF_HOME = nextflowHome;
  }

  return { ...environment, ...extra };
}

/** `NXF_HOME` the child processes use (Nextflow's default is `~/.nextflow`). */
export function resolveNextflowHome(config: Pick<NextflowConfig, 'nextflowHome'>): string {
  return config.nextflowHome ?? process.env.NXF_HOME ?? join(homedir(), '.nextflow');
}

/** Environment of an offline Nextflow call for one pipeline. */
export function offlineNextflowEnvironment(
  config: Pick<NextflowConfig, 'nextflowHome'>,
  spec: Pick<NextflowPipelineSpec, 'env'>,
): NodeJS.ProcessEnv {
  return childEnvironment(config, { ...spec.env, ...FIXED_NEXTFLOW_ENV }, true);
}

/**
 * Runs a tool with an argument array (no shell) and a hard timeout (SIGKILL). Never rejects:
 * a missing binary, non-zero exit or timeout is reported as `ok: false`.
 */
export function runTool(
  bin: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number },
): Promise<ToolResult> {
  return new Promise((resolve) => {
    try {
      execFile(
        bin,
        [...args],
        {
          cwd: options.cwd,
          encoding: 'utf8',
          env: options.env,
          killSignal: 'SIGKILL',
          maxBuffer: TOOL_MAX_BUFFER_BYTES,
          shell: false,
          timeout: options.timeoutMs ?? TOOL_TIMEOUT_MS,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({
              code: 0,
              ok: true,
              stderr: String(stderr),
              stdout: String(stdout),
              timedOut: false,
            });
            return;
          }

          const timedOut = Boolean((error as { killed?: boolean }).killed);
          resolve({
            code: typeof error.code === 'number' ? error.code : null,
            ok: false,
            stderr: String(stderr ?? ''),
            stdout: String(stdout ?? ''),
            timedOut,
          });
        },
      );
    } catch {
      resolve({ code: null, ok: false, stderr: '', stdout: '', timedOut: false });
    }
  });
}

/** `nf-validation@1.1.3` → `${NXF_HOME}/plugins/nf-validation-1.1.3`. */
export function pluginDirectory(nextflowHome: string, plugin: string): string {
  return join(nextflowHome, 'plugins', plugin.replace('@', '-'));
}

/**
 * The readiness checks of one Nextflow pipeline (design C7, spike OQ3), in reason order:
 * `nextflow -version` → `docker info` → `docker image inspect` of every registry image →
 * `nextflow info -o json <repo>` (offline) lists the registry revision under `revisions.pulled`
 * → every plugin directory exists. `stopAtFirstFailure` keeps the background refresh cheap;
 * `pipelines:check` runs everything to print a full report.
 */
export async function runReadinessChecks(input: {
  config: NextflowConfig;
  spec: NextflowPipelineSpec;
  /** Private scratch directory used as cwd (`nextflow info` writes `.nextflow/` there). */
  workDirectory: string;
  stopAtFirstFailure: boolean;
}): Promise<ReadinessCheck[]> {
  const { config, spec, stopAtFirstFailure, workDirectory } = input;
  const nextflowEnv = offlineNextflowEnvironment(config, spec);
  const dockerEnv = childEnvironment(config, {}, false);
  const checks: ReadinessCheck[] = [];
  const failed = () => stopAtFirstFailure && checks.some((check) => !check.ok);

  const version = await runTool(config.nextflowBin, ['-version'], {
    cwd: workDirectory,
    env: nextflowEnv,
  });
  checks.push({
    detail: version.ok ? _nextflowVersion(version.stdout) : _toolFailure(version),
    name: 'nextflow',
    ok: version.ok,
    reason: 'NEXTFLOW_MISSING',
  });

  if (failed()) {
    return checks;
  }

  const docker = await runTool(config.dockerBin, ['info', '--format', '{{.ServerVersion}}'], {
    env: dockerEnv,
  });
  checks.push({
    detail: docker.ok ? `server ${_firstLine(docker.stdout)}` : _toolFailure(docker),
    name: 'docker',
    ok: docker.ok,
    reason: 'DOCKER_UNAVAILABLE',
  });

  if (failed()) {
    return checks;
  }

  for (const image of spec.images) {
    const inspected = await inspectImage(config, image.ref);
    checks.push({
      detail: inspected.present ? (inspected.digest ?? 'present') : 'not pulled',
      name: `image ${image.ref}`,
      ok: inspected.present,
      reason: 'ASSETS_MISSING',
    });

    if (failed()) {
      return checks;
    }
  }

  const info = await runTool(config.nextflowBin, ['info', '-o', 'json', spec.repository], {
    cwd: workDirectory,
    env: nextflowEnv,
  });
  const pulled = info.ok && _pulledRevisions(info.stdout).includes(spec.revision);
  checks.push({
    detail: pulled ? `revision ${spec.revision} cached` : `revision ${spec.revision} not cached`,
    name: `pipeline ${spec.repository}@${spec.revision}`,
    ok: pulled,
    reason: 'ASSETS_MISSING',
  });

  if (failed()) {
    return checks;
  }

  const nextflowHome = resolveNextflowHome(config);

  for (const plugin of spec.plugins) {
    const installed = await _isDirectory(pluginDirectory(nextflowHome, plugin));
    checks.push({
      detail: installed ? 'installed' : 'not installed',
      name: `plugin ${plugin}`,
      ok: installed,
      reason: 'ASSETS_MISSING',
    });

    if (failed()) {
      return checks;
    }
  }

  return checks;
}

/** `docker image inspect` (local only); the first repo digest when the image is present. */
export async function inspectImage(
  config: Pick<NextflowConfig, 'dockerBin' | 'nextflowHome'>,
  ref: string,
): Promise<{ present: boolean; digest: string | null }> {
  const result = await runTool(
    config.dockerBin,
    ['image', 'inspect', '--format', '{{json .RepoDigests}}', ref],
    { env: childEnvironment(config, {}, false) },
  );

  if (!result.ok) {
    return { digest: null, present: false };
  }

  try {
    const digests = JSON.parse(_firstLine(result.stdout)) as unknown;
    const digest = Array.isArray(digests)
      ? digests.find((value): value is string => typeof value === 'string')
      : undefined;

    return { digest: digest ? digest.slice(digest.indexOf('@') + 1) : null, present: true };
  } catch {
    return { digest: null, present: true };
  }
}

export type PipelineReadiness = ReturnType<typeof createPipelineReadiness>;

/**
 * Cached readiness of every Nextflow pipeline (design C7 `isReady`, US-016 AC2, US-019 AC6).
 * Checks run in the background every `NEXTFLOW_READINESS_INTERVAL_MS` (never per request) with
 * a timeout on every tool call; `state()` only reads the cached result. Until the first refresh
 * completes a pipeline is unavailable without a reason.
 */
export function createPipelineReadiness(options: {
  config: NextflowConfig;
  logger: ReadinessLogger;
  pipelines: readonly PipelineDefinition[];
}) {
  const { config, logger } = options;
  const definitions = options.pipelines.filter((definition) => definition.nextflow);
  const states = new Map<string, PipelineReadinessState>();
  let timer: NodeJS.Timeout | null = null;
  let current: Promise<void> | null = null;

  function state(pipelineId: string): PipelineReadinessState {
    if (!config.nextflowEnabled) {
      return { ready: false, reason: 'NEXTFLOW_DISABLED' };
    }

    return states.get(pipelineId) ?? { ready: false, reason: null };
  }

  /** One refresh of every pipeline; concurrent callers share the same pass. */
  function refresh(): Promise<void> {
    if (!config.nextflowEnabled) {
      return Promise.resolve();
    }

    current ??= _refresh().finally(() => {
      current = null;
    });

    return current;
  }

  /** Starts the background refresh (no-op when Nextflow is disabled or already started). */
  function start(): void {
    if (!config.nextflowEnabled || timer) {
      return;
    }

    void refresh();
    timer = setInterval(() => void refresh(), config.nextflowReadinessIntervalMs);
    timer.unref();
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function _refresh(): Promise<void> {
    let workDirectory: string | null = null;

    try {
      workDirectory = await mkdtemp(join(tmpdir(), 'portal-nf-readiness-'));

      for (const definition of definitions) {
        const spec = definition.nextflow;

        if (!spec) {
          continue;
        }

        const checks = await runReadinessChecks({
          config,
          spec,
          stopAtFirstFailure: true,
          workDirectory,
        });
        const failure = checks.find((check) => !check.ok);
        _setState(definition.id, {
          ready: !failure,
          reason: failure ? failure.reason : null,
        });
      }
    } catch (error) {
      for (const definition of definitions) {
        _setState(definition.id, { ready: false, reason: 'NEXTFLOW_MISSING' });
      }

      logger.warn(
        { errorType: error instanceof Error ? error.name : 'unknown' },
        'Pipeline readiness check failed',
      );
    } finally {
      if (workDirectory) {
        await rm(workDirectory, { force: true, recursive: true }).catch(() => undefined);
      }
    }
  }

  function _setState(pipelineId: string, next: PipelineReadinessState): void {
    const previous = states.get(pipelineId);
    states.set(pipelineId, next);

    if (previous?.ready === next.ready && previous.reason === next.reason) {
      return;
    }

    if (next.ready) {
      logger.info({ pipelineId }, 'Pipeline readiness changed: ready');
    } else {
      logger.warn({ pipelineId, reason: next.reason }, 'Pipeline readiness changed: unavailable');
    }
  }

  return { refresh, start, state, stop };
}

function _nextflowVersion(stdout: string): string {
  const match = /version\s+([0-9][^\s]*)/.exec(stdout);
  return match ? `version ${match[1]}` : 'available';
}

function _pulledRevisions(stdout: string): string[] {
  try {
    const parsed = JSON.parse(stdout) as { revisions?: { pulled?: unknown } };
    const pulled = parsed.revisions?.pulled;

    return Array.isArray(pulled)
      ? pulled.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function _firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '') ?? '';
}

function _toolFailure(result: ToolResult): string {
  if (result.timedOut) {
    return 'timed out';
  }

  return result.code === null ? 'not found or not executable' : `exit ${result.code}`;
}

async function _isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
