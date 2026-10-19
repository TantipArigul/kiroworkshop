import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NEXTFLOW_CONFIG_DEFAULTS } from '../../../src/modules/pipelines/nextflow-adapter.js';
import {
  childEnvironment,
  createPipelineReadiness,
  FIXED_NEXTFLOW_ENV,
  offlineNextflowEnvironment,
  pluginDirectory,
  resolveNextflowHome,
  runTool,
} from '../../../src/modules/pipelines/readiness.js';
import { PIPELINE_REGISTRY } from '../../../src/modules/pipelines/registry.js';

const SECRET_KEYS = ['SESSION_SECRET', 'DATABASE_URL', 'IDENTITY_CLI_PASSWORD', 'AWS_SECRET'];
const silentLogger = { info: () => undefined, warn: () => undefined };
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(
    [...SECRET_KEYS, 'NXF_HOME', 'PATH', 'HOME'].map((key) => [key, process.env[key]]),
  );

  for (const key of SECRET_KEYS) {
    // Synthetic placeholder values only; the assertions check the keys never pass through.
    process.env[key] = `synthetic-${key.toLowerCase()}`;
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('child environment allowlist (C7, US-019 AC3)', () => {
  it('passes only PATH, HOME, JAVA_HOME, TMPDIR, LANG and the fixed extras', () => {
    const environment = childEnvironment({ nextflowHome: null }, { EXTRA: '1' }, false);

    expect(
      Object.keys(environment).every((key) =>
        ['PATH', 'HOME', 'JAVA_HOME', 'TMPDIR', 'LANG', 'EXTRA'].includes(key),
      ),
    ).toBe(true);
    expect(environment.PATH).toBe(process.env.PATH);

    for (const key of SECRET_KEYS) {
      expect(environment).not.toHaveProperty(key);
    }
  });

  it('adds NXF_HOME only for Nextflow calls, preferring the configured value', () => {
    process.env.NXF_HOME = '/env/nxf-home';

    expect(childEnvironment({ nextflowHome: null }, {}, false)).not.toHaveProperty('NXF_HOME');
    expect(childEnvironment({ nextflowHome: null }, {}, true).NXF_HOME).toBe('/env/nxf-home');
    expect(childEnvironment({ nextflowHome: '/cfg/nxf' }, {}, true).NXF_HOME).toBe('/cfg/nxf');
  });

  it('runs Nextflow offline with the pipeline syntax parser', () => {
    const spec = PIPELINE_REGISTRY.find((definition) => definition.nextflow)?.nextflow;
    const environment = offlineNextflowEnvironment({ nextflowHome: '/nxf' }, spec!);

    expect(environment).toMatchObject({
      ...FIXED_NEXTFLOW_ENV,
      NXF_HOME: '/nxf',
      NXF_OFFLINE: 'true',
      NXF_SYNTAX_PARSER: 'v1',
    });
    expect(Object.keys(environment).some((key) => SECRET_KEYS.includes(key))).toBe(false);
  });
});

describe('readiness helpers', () => {
  it('resolves NXF_HOME and plugin directories', () => {
    delete process.env.NXF_HOME;

    expect(resolveNextflowHome({ nextflowHome: null })).toBe(join(homedir(), '.nextflow'));
    expect(resolveNextflowHome({ nextflowHome: '/n' })).toBe('/n');
    expect(pluginDirectory('/n', 'nf-validation@1.1.3')).toBe(
      join('/n', 'plugins', 'nf-validation-1.1.3'),
    );
  });

  it('reports a missing binary as not ok instead of throwing', async () => {
    const result = await runTool('/nonexistent/portal-test-tool', ['-version'], {
      env: childEnvironment({ nextflowHome: null }, {}, false),
    });

    expect(result).toMatchObject({ code: null, ok: false, timedOut: false });
  });

  it('times out a hung tool with SIGKILL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'portal-readiness-'));

    try {
      const result = await runTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: directory,
        env: childEnvironment({ nextflowHome: null }, {}, false),
        timeoutMs: 200,
      });

      expect(result).toMatchObject({ ok: false, timedOut: true });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('reports NEXTFLOW_DISABLED without running any check when Nextflow is off', async () => {
    const readiness = createPipelineReadiness({
      config: { ...NEXTFLOW_CONFIG_DEFAULTS, nextflowBin: '/nonexistent', nextflowEnabled: false },
      logger: silentLogger,
      pipelines: PIPELINE_REGISTRY,
    });

    readiness.start();
    await readiness.refresh();

    expect(readiness.state('wf-renamefastq')).toEqual({
      ready: false,
      reason: 'NEXTFLOW_DISABLED',
    });
    readiness.stop();
  });

  it('is unavailable without a reason until the first refresh, then reports the reason', async () => {
    const readiness = createPipelineReadiness({
      config: {
        ...NEXTFLOW_CONFIG_DEFAULTS,
        nextflowBin: '/nonexistent/nextflow',
        nextflowEnabled: true,
      },
      logger: silentLogger,
      pipelines: PIPELINE_REGISTRY,
    });

    expect(readiness.state('wf-renamefastq')).toEqual({ ready: false, reason: null });
    await readiness.refresh();
    expect(readiness.state('wf-renamefastq')).toEqual({
      ready: false,
      reason: 'NEXTFLOW_MISSING',
    });
    readiness.stop();
  });
});
