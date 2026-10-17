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
export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
export const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING'] as const;
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
