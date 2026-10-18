/**
 * Pipelines admin CLI — Twelve-Factor one-off admin process (design C9).
 *
 *   node --env-file=.env apps/api/dist/cli/pipelines.js pipelines:setup   # online, once
 *   node --env-file=.env apps/api/dist/cli/pipelines.js pipelines:check   # offline
 *
 * Repository, revision, plugins and images come from the reviewed pipeline registry only; no
 * argument can change them. Tools run with argument arrays (no shell) and the same environment
 * allowlist as a run, so no portal secret reaches a child process. Output holds tool names,
 * versions, digests and counts only — never storage paths or environment values.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';

import { renamefastqOptionsSchema } from '@portal/shared';

import type { PortalConfig } from '../config/config.js';
import { ConfigValidationError, loadConfig } from '../config/index.js';
import { createJobStorage, type JobStorage } from '../modules/jobs/job-storage.js';
import { buildRunParams } from '../modules/pipelines/nextflow-adapter.js';
import {
  childEnvironment,
  inspectImage,
  runReadinessChecks,
  runTool,
  type ReadinessCheck,
} from '../modules/pipelines/readiness.js';
import { PIPELINE_REGISTRY, type NextflowPipelineSpec } from '../modules/pipelines/registry.js';
import { createLogger } from '../shared/logger.js';

const USAGE = `Usage: pipelines <command>
  pipelines:setup   Online, run once by an administrator: pull every Nextflow pipeline revision,
                    plugin and container image listed in the pipeline registry, then print the
                    image digests for review.
  pipelines:check   Offline: run the readiness checks of every Nextflow pipeline (Nextflow,
                    Docker, images, cached revision, plugins), the offline-config guard and the
                    Docker file-sharing check. Exits 1 when anything is missing.`;

const MINUTE_MS = 60_000;
const PULL_TIMEOUT_MS = 15 * MINUTE_MS;
const IMAGE_PULL_TIMEOUT_MS = 60 * MINUTE_MS;
const MOUNT_CHECK_TIMEOUT_MS = 2 * MINUTE_MS;
/** Synthetic job ID (never a cuid) used only to build `params.json` for the offline guard. */
const CHECK_JOB_ID = 'pipelinescheck0000000000';
/** Remote config loads in `.nextflow.log`: the HTTP file system or a config parsed from a URL. */
const REMOTE_CONFIG_PATTERN = /XFileSystemProvider|Parsing config file:\s*[a-z][a-z0-9+.-]*:\/\//i;
const RUN_LOG_FILE = '.nextflow.log';
const MOUNT_TARGET = '/portal-storage-check';

type CliLogger = ReturnType<typeof createLogger>;

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if ((command !== 'pipelines:setup' && command !== 'pipelines:check') || rest.length > 0) {
    process.stderr.write(
      `${command ? `Unknown command "${command}".` : 'Missing command.'} Repository, revision and images come from the pipeline registry and cannot be passed as arguments.\n\n${USAGE}\n`,
    );
    return 2;
  }

  let config: PortalConfig;

  try {
    config = loadConfig(process.env);
  } catch (error) {
    const fields = error instanceof ConfigValidationError ? error.fields.join(', ') : 'unknown';
    process.stderr.write(`Configuration is invalid (${fields}). Check the environment file.\n`);
    return 1;
  }

  const logger = createLogger(config);
  let workDirectory: string | null = null;

  try {
    // Private scratch cwd: `nextflow info` writes a `.nextflow/` cache into its cwd.
    workDirectory = await mkdtemp(join(tmpdir(), 'portal-nf-cli-'));

    return command === 'pipelines:setup'
      ? await setup(config, logger, workDirectory)
      : await check(config, logger, workDirectory);
  } catch (error) {
    logger.error({ command, errorType: error instanceof Error ? error.name : 'unknown' }, 'failed');
    process.stderr.write('The command failed. Check the application logs for details.\n');
    return 1;
  } finally {
    if (workDirectory) {
      await rm(workDirectory, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}

// ---------- pipelines:setup (online) ----------

async function setup(config: PortalConfig, logger: CliLogger, cwd: string): Promise<number> {
  let failed = 0;
  let steps = 0;
  const digests: { ref: string; digest: string | null }[] = [];

  for (const definition of PIPELINE_REGISTRY) {
    const spec = definition.nextflow;

    if (!spec) {
      continue;
    }

    process.stdout.write(`pipelines:setup ${definition.id} ${spec.revision} (online)\n`);
    // Same allowlist as a run, but online: no NXF_OFFLINE.
    const nextflowEnv = childEnvironment(
      config,
      { ...spec.env, NXF_DISABLE_CHECK_LATEST: 'true' },
      true,
    );
    const dockerEnv = childEnvironment(config, {}, false);
    const commands: {
      label: string;
      bin: string;
      args: string[];
      env: NodeJS.ProcessEnv;
      timeoutMs: number;
    }[] = [
      {
        args: ['pull', spec.repository, '-r', spec.revision],
        bin: config.nextflowBin,
        env: nextflowEnv,
        label: `nextflow pull ${spec.repository} -r ${spec.revision}`,
        timeoutMs: PULL_TIMEOUT_MS,
      },
      ...spec.plugins.map((plugin) => ({
        args: ['plugin', 'install', plugin],
        bin: config.nextflowBin,
        env: nextflowEnv,
        label: `nextflow plugin install ${plugin}`,
        timeoutMs: PULL_TIMEOUT_MS,
      })),
      ...spec.images.flatMap((image) => {
        const pullRef = image.source ?? image.ref;
        const pull = {
          args: ['pull', '--platform', image.platform, pullRef],
          bin: config.dockerBin,
          env: dockerEnv,
          label: `docker pull --platform ${image.platform} ${pullRef}`,
          timeoutMs: IMAGE_PULL_TIMEOUT_MS,
        };

        // Registry `source` (design Add-on MultiQC): tag the pulled image with the pipeline's name.
        return image.source
          ? [
              pull,
              {
                args: ['tag', image.source, image.ref],
                bin: config.dockerBin,
                env: dockerEnv,
                label: `docker tag ${image.source} ${image.ref}`,
                timeoutMs: PULL_TIMEOUT_MS,
              },
            ]
          : [pull];
      }),
    ];

    for (const step of commands) {
      const startedAt = Date.now();
      const result = await runTool(step.bin, step.args, {
        cwd,
        env: step.env,
        timeoutMs: step.timeoutMs,
      });
      steps += 1;
      failed += result.ok ? 0 : 1;
      process.stdout.write(
        `  ${result.ok ? 'ok    ' : 'FAILED'}  ${_seconds(Date.now() - startedAt)}  ${step.label}${result.ok ? '' : ` (${_failure(result)})`}\n`,
      );

      if (!result.ok) {
        // The tool's own last error line (e.g. a registry "not found"), for the administrator.
        const reason = _lastLine(result.stderr) || _lastLine(result.stdout);
        process.stdout.write(reason ? `          ${reason.slice(0, 300)}\n` : '');
      }
    }

    process.stdout.write('  image digests (review before use):\n');

    for (const image of spec.images) {
      const inspected = await inspectImage(config, image.ref);
      digests.push({ digest: inspected.digest, ref: image.ref });
      process.stdout.write(
        `    ${image.ref}  ${inspected.present ? (inspected.digest ?? 'no repo digest') : 'missing'}\n`,
      );
    }
  }

  process.stdout.write(
    failed === 0
      ? `Setup finished: ${steps} step(s) succeeded. Run pipelines:check (offline) next.\n`
      : `Setup incomplete: ${failed} of ${steps} step(s) failed. Fix the network or tool error and run it again.\n`,
  );
  logger.info({ command: 'pipelines:setup', digests, failed, steps }, 'pipelines:setup finished');

  return failed === 0 ? 0 : 1;
}

// ---------- pipelines:check (offline) ----------

async function check(config: PortalConfig, logger: CliLogger, cwd: string): Promise<number> {
  const storage = createJobStorage(config.storageRoot);
  let total = 0;
  let failed = 0;

  for (const definition of PIPELINE_REGISTRY) {
    const spec = definition.nextflow;

    if (!spec) {
      continue;
    }

    process.stdout.write(`pipelines:check ${definition.id} ${spec.revision} (offline)\n`);
    const checks = await runReadinessChecks({
      config,
      spec,
      stopAtFirstFailure: false,
      workDirectory: cwd,
    });
    checks.push(await offlineConfigGuard(config, spec, storage));
    checks.push(await dockerFileSharing(config, spec, checks));

    for (const item of checks) {
      total += 1;
      failed += item.ok ? 0 : 1;
      process.stdout.write(`  ${item.ok ? 'ok    ' : 'FAILED'}  ${item.name}  ${item.detail}\n`);
    }
  }

  if (!config.nextflowEnabled) {
    process.stdout.write(
      'Note: NEXTFLOW_ENABLED=false, so the API reports the Nextflow pipelines unavailable (NEXTFLOW_DISABLED) until it is set to true.\n',
    );
  }

  process.stdout.write(
    failed === 0
      ? `All ${total} check(s) passed.\n`
      : `${failed} of ${total} check(s) failed. Run pipelines:setup (online) for missing assets.\n`,
  );
  logger.info({ checks: total, command: 'pipelines:check', failed }, 'pipelines:check finished');

  return failed === 0 ? 0 : 1;
}

/**
 * Offline-config guard (design Add-on Wave 3): `params.json` built by the adapter must point
 * `custom_config_base` at a local path inside the job's `run/` directory that does not exist,
 * and the newest run log (if any) must show no remote config load.
 */
async function offlineConfigGuard(
  config: PortalConfig,
  spec: NextflowPipelineSpec,
  storage: JobStorage,
): Promise<ReadinessCheck> {
  const params = buildRunParams({
    config,
    fastqRoot: 'check.fastq.gz',
    jobId: CHECK_JOB_ID,
    layout: 'SINGLE_FILE',
    options: renamefastqOptionsSchema.parse({}),
    sampleName: null,
    spec,
    storage,
  });
  const base = params.custom_config_base;
  const runDirectory = storage.jobSubdirectory(CHECK_JOB_ID, 'run');
  const localBase =
    typeof base === 'string' &&
    isAbsolute(base) &&
    !/^[a-z][a-z0-9+.-]*:/i.test(base) &&
    base.startsWith(`${runDirectory}${sep}`) &&
    !existsSync(base);
  const runLog = await _latestRunLog(storage);
  const remoteLoad = runLog ? REMOTE_CONFIG_PATTERN.test(runLog.content) : false;
  const logDetail = runLog
    ? `latest run log (job ${runLog.jobId}): ${remoteLoad ? 'REMOTE CONFIG LOAD FOUND' : 'no remote config load'}`
    : 'no previous run log to inspect';

  return {
    detail: `custom_config_base ${localBase ? 'is a local, non-existent path' : 'IS NOT A LOCAL NON-EXISTENT PATH'}; ${logDetail}`,
    name: 'offline config guard',
    ok: localBase && !remoteLoad,
    reason: 'ASSETS_MISSING',
  };
}

/**
 * Design risk #8: Docker Desktop must share `STORAGE_ROOT`. Bind-mounts it read-only into a
 * throwaway container of an already pulled registry image (`--pull never`, no network).
 */
async function dockerFileSharing(
  config: PortalConfig,
  spec: NextflowPipelineSpec,
  checks: readonly ReadinessCheck[],
): Promise<ReadinessCheck> {
  const name = 'docker file sharing (STORAGE_ROOT)';
  const image = spec.images.find((candidate) =>
    checks.some((item) => item.ok && item.name === `image ${candidate.ref}`),
  );

  if (!image) {
    return {
      detail: 'skipped: no pulled image to test with',
      name,
      ok: false,
      reason: 'ASSETS_MISSING',
    };
  }

  const result = await runTool(
    config.dockerBin,
    [
      'run',
      '--rm',
      '--pull',
      'never',
      '--network',
      'none',
      '--platform',
      image.platform,
      '--mount',
      `type=bind,source=${config.storageRoot},target=${MOUNT_TARGET},readonly`,
      '--entrypoint',
      'test',
      image.ref,
      '-d',
      MOUNT_TARGET,
    ],
    { env: childEnvironment(config, {}, false), timeoutMs: MOUNT_CHECK_TIMEOUT_MS },
  );

  return {
    detail: result.ok
      ? 'containers can mount STORAGE_ROOT'
      : `containers cannot mount STORAGE_ROOT (${_failure(result)}); share it in Docker Desktop → Settings → Resources → File sharing`,
    name,
    ok: result.ok,
    reason: 'DOCKER_UNAVAILABLE',
  };
}

async function _latestRunLog(
  storage: JobStorage,
): Promise<{ jobId: string; content: string } | null> {
  let latest: { jobId: string; path: string; mtimeMs: number } | null = null;

  for (const jobId of await storage.listJobIds()) {
    const path = join(storage.jobSubdirectory(jobId, 'run'), RUN_LOG_FILE);

    try {
      const stats = await stat(path);

      if (stats.isFile() && (!latest || stats.mtimeMs > latest.mtimeMs)) {
        latest = { jobId, mtimeMs: stats.mtimeMs, path };
      }
    } catch {
      // Not a Nextflow job, or the run never started.
    }
  }

  return latest ? { content: await readFile(latest.path, 'utf8'), jobId: latest.jobId } : null;
}

function _lastLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? ''
  );
}

function _seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).padStart(6)}s`;
}

function _failure(result: { code: number | null; timedOut: boolean }): string {
  if (result.timedOut) {
    return 'timed out';
  }

  return result.code === null ? 'tool not found or not executable' : `exit ${result.code}`;
}

process.exitCode = await main(process.argv.slice(2));
