import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMultipart, launchParts } from '../../support/multipart.js';
import {
  createPipelinesTestContext,
  FAKE_DOCKER,
  FAKE_NEXTFLOW,
  type PipelinesTestContext,
} from '../../support/pipelines-context.js';

const MULTIQC_REF = 'biocontainers/multiqc:1.21--pyhdfd78af_0';
const MULTIQC_SOURCE = 'quay.io/biocontainers/multiqc:1.21--pyhdfd78af_0';

describe('pipeline availability reason codes (US-016 AC2, US-019 AC6)', () => {
  let context: PipelinesTestContext | null = null;

  afterEach(async () => {
    await context?.cleanup();
    context = null;
  });

  it.each([
    ['NEXTFLOW_MISSING', { environment: { NEXTFLOW_BIN: '/nonexistent/nextflow' } }],
    ['DOCKER_UNAVAILABLE', { environment: { DOCKER_BIN: '/nonexistent/docker' } }],
    ['ASSETS_MISSING', { withPlugin: false }],
    ['ASSETS_MISSING', { fakeState: { missingImages: [MULTIQC_REF] } }],
    ['ASSETS_MISSING', { fakeState: { unpulled: true } }],
  ] as const)(
    'reports %s, refuses launches with 503 before reading files, keeps Smart Checkup available',
    async (reason, options) => {
      context = await createPipelinesTestContext(options);
      const owner = await context.signIn(`reason-${reason.toLowerCase()}@example.test`);

      expect(await context.waitForReadiness(owner)).toEqual({
        available: false,
        unavailableReason: reason,
      });

      const catalog = await owner.get('/api/v1/pipelines');
      expect(catalog.body.data.items[0]).toMatchObject({ available: true, id: 'smart-checkup' });

      const launch = await context.launch(owner, {
        files: ['reads.fastq.gz'],
        layout: 'SINGLE_FILE',
      });
      expect(launch.status).toBe(503);
      expect(launch.body.error).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'This pipeline is not available right now. No run was created.',
      });
      expect(await context.prisma.job.count()).toBe(0);
      // Refused before the receiver ran: not even the uploads/ directory was created.
      expect(await context.stagingEntries()).toEqual([]);

      const ready = await owner.get('/health/ready');
      expect(ready.status).toBe(200);
      expect(ready.body.data.checks['pipeline:wf-renamefastq']).toBe('failed');
    },
  );

  it('reports NEXTFLOW_DISABLED and omits the pipeline readiness check when disabled', async () => {
    context = await createPipelinesTestContext({ environment: { NEXTFLOW_ENABLED: 'false' } });
    const owner = await context.signIn('disabled@example.test');

    expect(await context.waitForReadiness(owner)).toEqual({
      available: false,
      unavailableReason: 'NEXTFLOW_DISABLED',
    });
    expect((await owner.get('/health/ready')).body.data.checks).toEqual({
      database: 'ok',
      executor: 'ok',
    });

    const { body, contentType } = buildMultipart(
      launchParts({ files: ['reads.fastq.gz'], layout: 'SINGLE_FILE' }),
    );
    const launch = await owner.postRaw('/api/v1/pipelines/wf-renamefastq/runs', body, {
      'Content-Type': contentType,
      'Idempotency-Key': crypto.randomUUID(),
    });
    expect(launch.status).toBe(503);
    expect(await context.stagingEntries()).toEqual([]);
    expect(await context.fakeCalls('nextflow')).toEqual([]);
  });

  it('runs readiness offline with argument arrays only (no shell, no network)', async () => {
    context = await createPipelinesTestContext();
    const owner = await context.signIn('calls@example.test');
    expect((await context.waitForReadiness(owner)).available).toBe(true);

    expect(await context.fakeCalls('nextflow')).toEqual([
      ['-version'],
      ['info', '-o', 'json', 'si-lol/wf-renamefastq'],
    ]);
    const docker = await context.fakeCalls('docker');
    expect(docker[0]).toEqual(['info', '--format', '{{.ServerVersion}}']);
    expect(docker.filter((args) => args[0] === 'image')).toHaveLength(5);
    expect(docker.some((args) => args[0] === 'pull')).toBe(false);
  });
});

// ---------- pipelines:setup / pipelines:check CLI (C9) ----------

describe('pipelines CLI with fake tools', () => {
  let sandbox: string;
  let storageRoot: string;
  let nextflowHome: string;
  let stateDirectory: string;
  let savedEnvironment: NodeJS.ProcessEnv;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'portal-pipelines-cli-'));
    storageRoot = join(sandbox, 'storage');
    nextflowHome = join(sandbox, 'nxf-home');
    stateDirectory = join(sandbox, 'tmp', 'portal-fake-docker');
    await mkdir(storageRoot, { recursive: true });
    await mkdir(stateDirectory, { recursive: true });
    await mkdir(join(nextflowHome, 'plugins', 'nf-validation-1.1.3'), { recursive: true });
    savedEnvironment = { ...process.env };
  });

  afterEach(async () => {
    process.env = savedEnvironment;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    await rm(sandbox, { force: true, recursive: true });
  });

  /** Runs the one-off CLI module in-process (it calls `main(argv)` on import). */
  async function runCli(args: string[], environment: Record<string, string> = {}) {
    process.env = {
      ...savedEnvironment,
      ALLOWED_ORIGINS: 'https://localhost',
      DATABASE_URL: `file:${join(sandbox, 'cli.db')}`,
      DOCKER_BIN: FAKE_DOCKER,
      LOG_LEVEL: 'fatal',
      NEXTFLOW_BIN: FAKE_NEXTFLOW,
      NEXTFLOW_HOME: nextflowHome,
      NODE_ENV: 'test',
      SESSION_SECRET: 'a-secure-test-session-secret-with-32-chars',
      STORAGE_ROOT: storageRoot,
      TMPDIR: join(sandbox, 'tmp'),
      ...environment,
    };
    process.argv = [process.argv[0] ?? 'node', 'pipelines.js', ...args];
    let output = '';
    const capture = (chunk: unknown) => {
      output += String(chunk);
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    vi.resetModules();
    await import('../../../src/cli/pipelines.js');
    vi.restoreAllMocks();
    const exitCode = process.exitCode;
    process.exitCode = undefined;

    return { exitCode, output };
  }

  async function calls(tool: 'docker' | 'nextflow'): Promise<string[][]> {
    const text = await readFile(join(stateDirectory, `${tool}-calls.log`), 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  }

  it('pipelines:check passes all 11 checks offline on a prepared machine', async () => {
    const result = await runCli(['pipelines:check']);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('All 11 check(s) passed.');
    expect(result.output).toContain('offline config guard');
    expect(result.output).toContain('docker file sharing (STORAGE_ROOT)');
    expect(result.output).toContain('NEXTFLOW_ENABLED=false');
    expect(result.output).not.toContain(storageRoot);
    expect((await calls('docker')).some((args) => args[0] === 'pull')).toBe(false);
  });

  it('pipelines:check exits 1 and names the failing checks when tools or assets are missing', async () => {
    await writeFile(join(stateDirectory, 'missing-images.txt'), `${MULTIQC_REF}\n`);
    const missingImage = await runCli(['pipelines:check']);
    const missingNextflow = await runCli(['pipelines:check'], {
      NEXTFLOW_BIN: '/nonexistent/nextflow',
    });

    expect(missingImage.exitCode).toBe(1);
    expect(missingImage.output).toMatch(new RegExp(`FAILED {2}image ${MULTIQC_REF} {2}not pulled`));
    expect(missingImage.output).toContain('1 of 11 check(s) failed.');
    expect(missingNextflow.exitCode).toBe(1);
    expect(missingNextflow.output).toMatch(/FAILED {2}nextflow {2}not found or not executable/);
  });

  it('pipelines:check fails the offline guard when a run log shows a remote config load', async () => {
    const runDirectory = join(storageRoot, 'jobs', 'cremoteconfiglog00000000', 'run');
    await mkdir(runDirectory, { recursive: true });
    await writeFile(
      join(runDirectory, '.nextflow.log'),
      'DEBUG nextflow.config.ConfigParser - Parsing config file: https://raw.githubusercontent.com/x/nfcore_custom.config\n',
    );

    const result = await runCli(['pipelines:check']);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('REMOTE CONFIG LOAD FOUND');
    expect(result.output).not.toContain('raw.githubusercontent.com');
  });

  it('pipelines:setup pulls revision, plugin and images, and pulls+tags a registry source (Add-on MultiQC)', async () => {
    const result = await runCli(['pipelines:setup']);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Setup finished: 8 step(s) succeeded.');
    expect(await calls('nextflow')).toEqual([
      ['pull', 'si-lol/wf-renamefastq', '-r', '1.0.3'],
      ['plugin', 'install', 'nf-validation@1.1.3'],
    ]);

    const docker = await calls('docker');
    const pulls = docker.filter((args) => args[0] === 'pull');
    const tags = docker.filter((args) => args[0] === 'tag');

    expect(pulls).toHaveLength(5);
    expect(pulls.every((args) => args[1] === '--platform' && args[2] === 'linux/amd64')).toBe(true);
    expect(pulls.map((args) => args[3])).toContain(MULTIQC_SOURCE);
    expect(pulls.map((args) => args[3])).not.toContain(MULTIQC_REF);
    expect(tags).toEqual([['tag', MULTIQC_SOURCE, MULTIQC_REF]]);
    expect(docker.indexOf(tags[0]!)).toBeGreaterThan(
      docker.findIndex((args) => args[0] === 'pull' && args[3] === MULTIQC_SOURCE),
    );
    expect(result.output).toContain(`${MULTIQC_REF}  sha256:${'0'.repeat(64)}`);
  });

  it('pipelines:setup exits 1 when a tool fails and refuses repository/revision arguments', async () => {
    const failing = await runCli(['pipelines:setup'], { DOCKER_BIN: '/nonexistent/docker' });
    const withArgument = await runCli(['pipelines:setup', 'other/repo']);
    const unknown = await runCli(['pipelines:pull']);

    expect(failing.exitCode).toBe(1);
    expect(failing.output).toContain('Setup incomplete: 6 of 8 step(s) failed.');
    expect(withArgument.exitCode).toBe(2);
    expect(withArgument.output).toContain('cannot be passed as arguments');
    expect(unknown.exitCode).toBe(2);
  });
});
