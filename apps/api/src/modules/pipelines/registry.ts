import {
  RENAMEFASTQ_DEFAULT_KIT_NAME,
  RENAMEFASTQ_DEFAULT_Q_SCORE,
  RENAMEFASTQ_KIT_NAMES,
  RENAMEFASTQ_Q_SCORE_MAX,
  RENAMEFASTQ_Q_SCORE_MIN,
  type PipelineExecutor,
  type PipelineId,
  type PipelineOptionDescriptor,
  type RenamefastqOptions,
  type RunInputLayout,
} from '@portal/shared';

/** Absolute paths and validated values a Nextflow run is built from (never raw client input). */
export type RunParamsInput = {
  layout: RunInputLayout;
  sampleName: string | null;
  options: RenamefastqOptions;
  /** Absolute path of the FASTQ file (SINGLE_FILE) or folder under `jobs/{id}/input/`. */
  fastqPath: string;
  /** Absolute path of `input/sample_sheet.csv` (BARCODE_FOLDERS only). */
  sampleSheetPath: string | null;
  /** Absolute path of `jobs/{id}/output`. */
  outdir: string;
  /**
   * Absolute local path that holds no configs. The pipeline's `nextflow.config` otherwise
   * downloads nf-core institutional configs from GitHub even with `NXF_OFFLINE=true`.
   */
  customConfigBase: string;
};

export type ResourceCaps = { maxCpus: number; maxMemoryGb: number; maxTimeHours: number };

export type NextflowParams = Record<string, string | number | boolean>;

export type NextflowPipelineSpec = {
  repository: 'si-lol/wf-renamefastq';
  revision: '1.0.3';
  profiles: readonly ['docker', 'arm'];
  env: { NXF_SYNTAX_PARSER: 'v1' };
  plugins: readonly ['nf-validation@1.1.3'];
  /**
   * `ref` is the name the pipeline uses (checked by readiness). `source`, when set, is the name
   * `pipelines:setup` pulls before tagging it as `ref` (the module's name is not pullable).
   */
  images: readonly { ref: string; source?: string; platform: 'linux/amd64' }[];
  requiredOutputs: readonly ['fastq/*.fastq.gz', 'stats/all_fastq_statistics.tsv'];
  buildParams(input: RunParamsInput, caps: ResourceCaps): NextflowParams;
};

export type PipelineDefinition = {
  id: PipelineId;
  name: string;
  description: string;
  version: string;
  executor: PipelineExecutor;
  inputLayouts: readonly RunInputLayout[];
  options: readonly PipelineOptionDescriptor[];
  nextflow?: NextflowPipelineSpec;
};

/** The only keys `buildParams` may emit (P12); anything else never reaches Nextflow. */
export const RENAMEFASTQ_PARAM_KEYS = [
  'fastq',
  'sample',
  'sample_sheet',
  'demultiplex',
  'kit_name',
  'quality_filter',
  'q_score',
  'outdir',
  'max_cpus',
  'max_memory',
  'max_time',
  'validate_params',
  'monochrome_logs',
  'custom_config_base',
] as const;

/** Values are always validated server-side before they get here (C4); paths are absolute. */
function buildRenamefastqParams(input: RunParamsInput, caps: ResourceCaps): NextflowParams {
  const params: NextflowParams = {
    fastq: input.fastqPath,
    demultiplex: input.options.demultiplex,
    quality_filter: input.options.qualityFilter,
    q_score: input.options.qScore,
    outdir: input.outdir,
    max_cpus: caps.maxCpus,
    max_memory: `${caps.maxMemoryGb}.GB`,
    max_time: `${caps.maxTimeHours}.h`,
    validate_params: true,
    monochrome_logs: true,
    custom_config_base: input.customConfigBase,
  };

  if (input.layout === 'BARCODE_FOLDERS') {
    if (input.sampleSheetPath) {
      params.sample_sheet = input.sampleSheetPath;
    }
  } else if (input.sampleName) {
    params.sample = input.sampleName;
  }

  if (input.options.demultiplex) {
    params.kit_name = input.options.kitName;
  }

  return params;
}

const RENAMEFASTQ_OPTIONS: readonly PipelineOptionDescriptor[] = [
  {
    default: false,
    description:
      'Split the reads by barcode before renaming. Not available for barcode folders, which are already split.',
    key: 'demultiplex',
    label: 'Demultiplex reads by barcode',
    type: 'boolean',
  },
  {
    default: RENAMEFASTQ_DEFAULT_KIT_NAME,
    description: 'The kit used for barcoding. Used only when demultiplexing.',
    key: 'kitName',
    label: 'Barcoding kit',
    type: 'enum',
    values: [...RENAMEFASTQ_KIT_NAMES],
  },
  {
    default: true,
    description: 'Keep only reads that reach the minimum Q-score.',
    key: 'qualityFilter',
    label: 'Quality filter',
    type: 'boolean',
  },
  {
    default: RENAMEFASTQ_DEFAULT_Q_SCORE,
    description: 'Minimum read quality used by the quality filter.',
    key: 'qScore',
    label: 'Minimum Q-score',
    max: RENAMEFASTQ_Q_SCORE_MAX,
    min: RENAMEFASTQ_Q_SCORE_MIN,
    type: 'integer',
  },
];

/**
 * Pipeline registry (design C2, D1A-9): the only pipelines the portal runs. Changes go through
 * a reviewed pull request; repository and revision are never taken from a request.
 */
export const PIPELINE_REGISTRY: readonly PipelineDefinition[] = [
  {
    description:
      'Simulated training analysis of a synthetic marker CSV with mock package recommendations. Training output only, not medical advice.',
    executor: 'simulated',
    id: 'smart-checkup',
    inputLayouts: [],
    name: 'Smart Checkup',
    options: [],
    version: 'builtin',
  },
  {
    description:
      'Renames and optionally demultiplexes Oxford Nanopore FASTQ files with a local, offline Nextflow run of si-lol/wf-renamefastq. Test or public data only.',
    executor: 'nextflow',
    id: 'wf-renamefastq',
    inputLayouts: ['SINGLE_FILE', 'SAMPLE_FOLDER', 'BARCODE_FOLDERS'],
    name: 'wf-renamefastq',
    nextflow: {
      buildParams: buildRenamefastqParams,
      env: { NXF_SYNTAX_PARSER: 'v1' },
      // Every container referenced by the 1.0.3 modules (MultiQC is declared but receives no
      // input in this revision). Pulled only by `pipelines:setup`.
      images: [
        {
          platform: 'linux/amd64',
          ref: 'ontresearch/wf-common:shad28e55140f75a68f59bbecc74e880aeab16ab158',
        },
        { platform: 'linux/amd64', ref: 'quay.io/biocontainers/seqkit:2.9.0--h9ee0642_0' },
        { platform: 'linux/amd64', ref: 'piroonj/dorado:hla-v1.2.0' },
        { platform: 'linux/amd64', ref: 'quay.io/nf-core/ubuntu:24.04' },
        {
          // The module names this image without a registry and the pipeline's
          // `docker.registry = 'quay.io'` is commented out, so Docker resolves it to Docker Hub,
          // where it cannot be pulled. Setup pulls it from quay.io and tags it with this name.
          platform: 'linux/amd64',
          ref: 'biocontainers/multiqc:1.21--pyhdfd78af_0',
          source: 'quay.io/biocontainers/multiqc:1.21--pyhdfd78af_0',
        },
      ],
      plugins: ['nf-validation@1.1.3'],
      profiles: ['docker', 'arm'],
      repository: 'si-lol/wf-renamefastq',
      requiredOutputs: ['fastq/*.fastq.gz', 'stats/all_fastq_statistics.tsv'],
      revision: '1.0.3',
    },
    options: RENAMEFASTQ_OPTIONS,
    version: '1.0.3',
  },
];

export function getPipelineDefinition(pipelineId: string): PipelineDefinition | null {
  return PIPELINE_REGISTRY.find((definition) => definition.id === pipelineId) ?? null;
}

/** Pipeline IDs run by the same executor kind (used for capacity and queue position). */
export function pipelineIdsForExecutor(executor: PipelineExecutor): PipelineId[] {
  return PIPELINE_REGISTRY.filter((definition) => definition.executor === executor).map(
    (definition) => definition.id,
  );
}

/** Pipeline IDs that share an executor with `pipelineId` (itself included). */
export function pipelineIdsSharingExecutor(pipelineId: string): PipelineId[] {
  const definition = getPipelineDefinition(pipelineId);
  return definition ? pipelineIdsForExecutor(definition.executor) : [];
}
