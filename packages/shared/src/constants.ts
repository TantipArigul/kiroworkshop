// Dependency-free constants. Browser code imports these from `@portal/shared/constants`
// so it does not bundle the Zod schemas exported by the package root.

export const USER_ROLES = ['USER', 'AUDITOR', 'ADMIN'] as const;
export const PERMISSIONS = ['AUDIT_READ', 'USER_MANAGE'] as const;
export const PASSWORD_MAX_LENGTH = 1024;
export const AUDIT_OUTCOMES = ['SUCCESS', 'DENIED', 'FAILURE'] as const;

export const AUDIT_EVENT_TYPES = [
  // Identity & Access
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'ACCOUNT_LOCKED',
  'LOGOUT',
  'AUTHORIZATION_DENIED',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'USER_CREATED',
  'USER_DISABLED',
  'USER_ENABLED',
  'USER_ROLE_CHANGED',
  'USER_ANONYMIZED',
  'AUDIT_QUERIED',
  'AUDIT_RETENTION_CLEANUP',
  // Recorded by downstream units through AuditService
  'JOB_SUBMITTED',
  'JOB_STATUS_CHANGED',
  'JOB_DELETED',
  'JOB_INPUT_REJECTED',
  'RESULT_DOWNLOADED',
] as const;

export const AUDIT_RESOURCE_TYPES = ['USER', 'SESSION', 'AUDIT', 'JOB', 'RESULT'] as const;

// Submission & Job Lifecycle — synthetic training input contract (design C1).
export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING'] as const;
export const TERMINAL_JOB_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'] as const;
export const AGE_BANDS = ['18-29', '30-39', '40-49', '50-59', '60+'] as const;
export const FOCUS_AREAS = ['GENERAL', 'CARDIOMETABOLIC', 'LIVER', 'KIDNEY'] as const;
export const LIFESTYLE_FACTORS = ['SMOKING', 'LOW_ACTIVITY', 'HIGH_ALCOHOL', 'POOR_SLEEP'] as const;

/** Validation ranges for synthetic training data only — not clinical reference ranges. */
export const INPUT_MARKERS = [
  { marker: 'fasting_glucose', unit: 'mg/dL', min: 40, max: 400 },
  { marker: 'hba1c', unit: '%', min: 3, max: 15 },
  { marker: 'ldl_cholesterol', unit: 'mg/dL', min: 20, max: 400 },
  { marker: 'hdl_cholesterol', unit: 'mg/dL', min: 10, max: 150 },
  { marker: 'triglycerides', unit: 'mg/dL', min: 20, max: 1000 },
  { marker: 'systolic_bp', unit: 'mmHg', min: 70, max: 250 },
  { marker: 'diastolic_bp', unit: 'mmHg', min: 40, max: 150 },
  { marker: 'bmi', unit: 'kg/m2', min: 10, max: 70 },
  { marker: 'alt', unit: 'U/L', min: 5, max: 500 },
  { marker: 'creatinine', unit: 'mg/dL', min: 0.2, max: 15 },
] as const;

export const INPUT_FILE_HEADER = 'marker,value,unit';
export const INPUT_FILE_MAX_BYTES = 65_536;
export const INPUT_FILE_MAX_ROWS = 50;
export const INPUT_FILE_NAME_MAX_LENGTH = 128;
export const SAMPLE_LABEL_MAX_LENGTH = 64;
export const JOB_POLL_INTERVAL_MS = 3_000;

// Pipeline Catalog & Nextflow Executor (design C1). Upload limits are fixed by the
// requirements, not by environment configuration.
export const PIPELINE_IDS = ['smart-checkup', 'wf-renamefastq'] as const;
export const PIPELINE_EXECUTORS = ['simulated', 'nextflow'] as const;
export const PIPELINE_UNAVAILABLE_REASONS = [
  'NEXTFLOW_DISABLED',
  'NEXTFLOW_MISSING',
  'DOCKER_UNAVAILABLE',
  'ASSETS_MISSING',
] as const;
export const RUN_INPUT_LAYOUTS = ['SINGLE_FILE', 'SAMPLE_FOLDER', 'BARCODE_FOLDERS'] as const;
/** Path depth (segments, including the file name) of each layout's FASTQ files. */
export const RUN_INPUT_LAYOUT_DEPTH = {
  SINGLE_FILE: 1,
  SAMPLE_FOLDER: 2,
  BARCODE_FOLDERS: 3,
} as const;
export const RUN_INPUT_FILE_KINDS = ['FASTQ', 'SAMPLE_SHEET'] as const;
export const FASTQ_EXTENSIONS = ['.fastq', '.fq', '.fastq.gz', '.fq.gz'] as const;
export const RUN_INPUT_MAX_BYTES = 1_073_741_824;
export const RUN_INPUT_MAX_FASTQ_FILES = 10;
export const RUN_INPUT_RELATIVE_PATH_MAX_LENGTH = 400;
export const SAMPLE_SHEET_MAX_BYTES = 65_536;
export const SAMPLE_SHEET_MAX_ROWS = 96;
export const SAMPLE_SHEET_HEADER = ['barcode', 'alias'] as const;
export const RUN_NAME_MAX_LENGTH = 64;
/** Applied to the trimmed value. The run name is never passed to Nextflow. */
export const RUN_NAME_PATTERN = /^[A-Za-z0-9 _.-]{1,64}$/;
/** Sample names and sheet aliases: the pipeline interpolates them into shell commands. */
export const SAMPLE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** One segment of an uploaded relative path; `..` is additionally rejected by the validator. */
export const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;
export const BARCODE_PATTERN = /^barcode\d{2,}$/;
/** Dorado's folder for reads without a barcode; the pipeline ignores it. */
export const UNCLASSIFIED_FOLDER = 'unclassified';

/** `kit_name` enum of si-lol/wf-renamefastq 1.0.3 (`nextflow_schema.json`). */
export const RENAMEFASTQ_KIT_NAMES = [
  'BiK-HLA114-96',
  'BiK-16S114-96',
  'EXP-NBD103',
  'EXP-NBD104',
  'EXP-NBD114',
  'EXP-NBD114-24',
  'EXP-NBD196',
  'EXP-PBC001',
  'EXP-PBC096',
  'SQK-16S024',
  'SQK-16S114-24',
  'SQK-DRB004-24',
  'SQK-LWB001',
  'SQK-MAB114-24',
  'SQK-MLK111-96-XL',
  'SQK-MLK114-96-XL',
  'SQK-NBD111-24',
  'SQK-NBD111-96',
  'SQK-NBD114-24',
  'SQK-NBD114-96',
  'SQK-PBK004',
  'SQK-PCB109',
  'SQK-PCB110',
  'SQK-PCB111-24',
  'SQK-PCB114-24',
  'SQK-RAB201',
  'SQK-RAB204',
  'SQK-RBK001',
  'SQK-RBK004',
  'SQK-RBK110-96',
  'SQK-RBK111-24',
  'SQK-RBK111-96',
  'SQK-RBK114-24',
  'SQK-RBK114-96',
  'SQK-RLB001',
  'SQK-RPB004',
  'SQK-RPB114-24',
  'TWIST-16-UDI',
  'TWIST-96A-UDI',
  'VSK-PTC001',
  'VSK-VMK001',
  'VSK-VMK004',
  'VSK-VPS001',
] as const;
export const RENAMEFASTQ_DEFAULT_KIT_NAME = 'BiK-HLA114-96';
export const RENAMEFASTQ_Q_SCORE_MIN = 0;
export const RENAMEFASTQ_Q_SCORE_MAX = 60;
export const RENAMEFASTQ_DEFAULT_Q_SCORE = 14;

// Results & Guidance (design C1).
/** `RESULT` = file written by the portal (Smart Checkup `result.json`); `OUTPUT` = pipeline output. */
export const RESULT_ARTIFACT_KINDS = ['RESULT', 'OUTPUT'] as const;
/** Position of a marker against the synthetic training midpoint — not a clinical reference. */
export const TRAINING_BANDS = ['BELOW_TRAINING_MIDPOINT', 'AT_OR_ABOVE_TRAINING_MIDPOINT'] as const;
/** Rule ID stored when no mock rule matches; no package is recommended. */
export const NO_MOCK_RECOMMENDATION_RULE_ID = 'NO_MATCH';
