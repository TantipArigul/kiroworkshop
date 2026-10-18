import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renamefastqOptionsSchema, type RunInputLayout } from '@portal/shared';

import {
  buildRunParams,
  NEXTFLOW_CONFIG_DEFAULTS,
  NO_CUSTOM_CONFIG_DIRECTORY,
  resolveNextflowConfig,
} from '../../../src/modules/pipelines/nextflow-adapter.js';
import {
  getPipelineDefinition,
  PIPELINE_REGISTRY,
  pipelineIdsForExecutor,
  pipelineIdsSharingExecutor,
  RENAMEFASTQ_PARAM_KEYS,
  type RunParamsInput,
} from '../../../src/modules/pipelines/registry.js';
import { createJobStorage } from '../../../src/modules/jobs/job-storage.js';

const CAPS = { maxCpus: 4, maxMemoryGb: 8, maxTimeHours: 8 };
const JOB_ID = 'cregistrytest000000000000';
const ROOT = join('/', 'portal-test-storage');

function spec() {
  const nextflow = getPipelineDefinition('wf-renamefastq')?.nextflow;

  if (!nextflow) {
    throw new Error('wf-renamefastq is missing from the registry');
  }

  return nextflow;
}

function paramsInput(overrides: Partial<RunParamsInput> = {}): RunParamsInput {
  return {
    customConfigBase: '/s/jobs/j/run/no-custom-config',
    fastqPath: '/s/jobs/j/input/fastq/reads.fastq.gz',
    layout: 'SINGLE_FILE',
    options: renamefastqOptionsSchema.parse({}),
    outdir: '/s/jobs/j/output',
    sampleName: null,
    sampleSheetPath: null,
    ...overrides,
  };
}

describe('pipeline registry (C2, D1A-9)', () => {
  it('lists exactly Smart Checkup (simulated) and wf-renamefastq 1.0.3 (nextflow)', () => {
    expect(PIPELINE_REGISTRY.map((definition) => [definition.id, definition.executor])).toEqual([
      ['smart-checkup', 'simulated'],
      ['wf-renamefastq', 'nextflow'],
    ]);
    expect(getPipelineDefinition('smart-checkup')).toMatchObject({
      inputLayouts: [],
      version: 'builtin',
    });
    expect(getPipelineDefinition('smart-checkup')?.nextflow).toBeUndefined();
    expect(getPipelineDefinition('unknown-pipeline')).toBeNull();
    expect(getPipelineDefinition('__proto__')).toBeNull();
  });

  it('pins repository, revision, profiles, offline env, plugin and required outputs', () => {
    expect(spec()).toMatchObject({
      env: { NXF_SYNTAX_PARSER: 'v1' },
      plugins: ['nf-validation@1.1.3'],
      profiles: ['docker', 'arm'],
      repository: 'si-lol/wf-renamefastq',
      requiredOutputs: ['fastq/*.fastq.gz', 'stats/all_fastq_statistics.tsv'],
      revision: '1.0.3',
    });
    expect(getPipelineDefinition('wf-renamefastq')?.inputLayouts).toEqual([
      'SINGLE_FILE',
      'SAMPLE_FOLDER',
      'BARCODE_FOLDERS',
    ]);
  });

  it('declares the five 1.0.3 images; only MultiQC has a pull source (Add-on MultiQC)', () => {
    const images = spec().images;

    expect(images).toHaveLength(5);
    expect(images.every((image) => image.platform === 'linux/amd64')).toBe(true);
    expect(images.filter((image) => image.source)).toEqual([
      {
        platform: 'linux/amd64',
        ref: 'biocontainers/multiqc:1.21--pyhdfd78af_0',
        source: 'quay.io/biocontainers/multiqc:1.21--pyhdfd78af_0',
      },
    ]);
  });

  it('groups pipelines by executor kind for capacity and queue position', () => {
    expect(pipelineIdsForExecutor('nextflow')).toEqual(['wf-renamefastq']);
    expect(pipelineIdsForExecutor('simulated')).toEqual(['smart-checkup']);
    expect(pipelineIdsSharingExecutor('wf-renamefastq')).toEqual(['wf-renamefastq']);
    expect(pipelineIdsSharingExecutor('nope')).toEqual([]);
  });
});

describe('wf-renamefastq buildParams (C2, P12, Add-on Wave 3)', () => {
  it('has a 14-key allowlist including custom_config_base', () => {
    expect(RENAMEFASTQ_PARAM_KEYS).toHaveLength(14);
    expect(RENAMEFASTQ_PARAM_KEYS).toContain('custom_config_base');
  });

  it.each([
    ['SINGLE_FILE', 'sample01', null, false, ['sample']],
    ['SAMPLE_FOLDER', null, null, true, ['kit_name']],
    ['BARCODE_FOLDERS', null, '/s/jobs/j/input/sample_sheet.csv', false, ['sample_sheet']],
  ] as const)(
    '%s emits only allowlisted keys with the expected optional keys',
    (layout, sampleName, sampleSheetPath, demultiplex, optional) => {
      const params = spec().buildParams(
        paramsInput({
          layout: layout as RunInputLayout,
          options: renamefastqOptionsSchema.parse({ demultiplex }),
          sampleName,
          sampleSheetPath,
        }),
        CAPS,
      );
      const always = [
        'custom_config_base',
        'demultiplex',
        'fastq',
        'max_cpus',
        'max_memory',
        'max_time',
        'monochrome_logs',
        'outdir',
        'q_score',
        'quality_filter',
        'validate_params',
      ];

      expect(Object.keys(params).sort()).toEqual([...always, ...optional].sort());
      expect(
        Object.keys(params).every((key) =>
          (RENAMEFASTQ_PARAM_KEYS as readonly string[]).includes(key),
        ),
      ).toBe(true);
    },
  );

  it('maps validated options and resource caps to typed Nextflow values', () => {
    const params = spec().buildParams(
      paramsInput({
        options: renamefastqOptionsSchema.parse({
          demultiplex: true,
          kitName: 'SQK-NBD114-24',
          qScore: 20,
          qualityFilter: false,
        }),
      }),
      { maxCpus: 2, maxMemoryGb: 16, maxTimeHours: 3 },
    );

    expect(params).toMatchObject({
      demultiplex: true,
      kit_name: 'SQK-NBD114-24',
      max_cpus: 2,
      max_memory: '16.GB',
      max_time: '3.h',
      monochrome_logs: true,
      q_score: 20,
      quality_filter: false,
      validate_params: true,
    });
  });

  it('never sends a sample name for barcode folders or a sample sheet for other layouts', () => {
    const barcode = spec().buildParams(
      paramsInput({ layout: 'BARCODE_FOLDERS', sampleName: 'ignored', sampleSheetPath: '/s.csv' }),
      CAPS,
    );
    const single = spec().buildParams(
      paramsInput({ layout: 'SINGLE_FILE', sampleName: null, sampleSheetPath: '/s.csv' }),
      CAPS,
    );

    expect(barcode).not.toHaveProperty('sample');
    expect(barcode.sample_sheet).toBe('/s.csv');
    expect(single).not.toHaveProperty('sample_sheet');
    expect(single).not.toHaveProperty('sample');
  });
});

describe('buildRunParams (adapter params.json)', () => {
  const storage = createJobStorage(ROOT);
  const config = { ...NEXTFLOW_CONFIG_DEFAULTS, nextflowMaxCpus: 3 };

  it('builds absolute paths confined to the job directory and a non-existent config base', () => {
    const params = buildRunParams({
      config,
      fastqRoot: 'fastq_pass',
      jobId: JOB_ID,
      layout: 'BARCODE_FOLDERS',
      options: renamefastqOptionsSchema.parse({}),
      sampleName: null,
      spec: spec(),
      storage,
    });
    const jobDirectory = storage.jobDirectory(JOB_ID);

    expect(params.fastq).toBe(join(jobDirectory, 'input', 'fastq', 'fastq_pass'));
    expect(params.sample_sheet).toBe(join(jobDirectory, 'input', 'sample_sheet.csv'));
    expect(params.outdir).toBe(join(jobDirectory, 'output'));
    expect(params.custom_config_base).toBe(join(jobDirectory, 'run', NO_CUSTOM_CONFIG_DIRECTORY));
    expect(String(params.custom_config_base).startsWith(`${jobDirectory}${sep}`)).toBe(true);
    expect(existsSync(String(params.custom_config_base))).toBe(false);
    expect(params.max_cpus).toBe(3);
  });

  it('refuses a FASTQ root that escapes the input directory', () => {
    expect(() =>
      buildRunParams({
        config,
        fastqRoot: '../../../etc',
        jobId: JOB_ID,
        layout: 'SAMPLE_FOLDER',
        options: renamefastqOptionsSchema.parse({}),
        sampleName: null,
        spec: spec(),
        storage,
      }),
    ).toThrow();
  });

  it('fills absent Nextflow settings with the config defaults and ignores unknown keys', () => {
    const resolved = resolveNextflowConfig({
      nextflowBin: '/opt/nextflow',
      nextflowMaxConcurrentRuns: undefined,
      ...({ sessionSecret: 'not-copied' } as object),
    });

    expect(resolved).toEqual({ ...NEXTFLOW_CONFIG_DEFAULTS, nextflowBin: '/opt/nextflow' });
    expect(resolved).not.toHaveProperty('sessionSecret');
  });
});
