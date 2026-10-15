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
  'RESULT_DOWNLOADED',
] as const;

export const AUDIT_RESOURCE_TYPES = ['USER', 'SESSION', 'AUDIT', 'JOB', 'RESULT'] as const;
