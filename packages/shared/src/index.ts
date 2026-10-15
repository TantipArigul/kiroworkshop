export { createSuccessResponse } from './contracts/api.js';
export {
  idempotencyKeyGenerator,
  jobStatusGenerator,
  retentionTimestampGenerator,
} from './testing/generators.js';
export {
  authenticatedUserSchema,
  apiErrorSchema,
  csrfTokenResponseSchema,
  auditNotificationSchema,
  currentUserResponseSchema,
  healthResponseSchema,
  jobStatusSchema,
  loginRequestSchema,
  loginResponseSchema,
  paginationSchema,
  readinessResponseSchema,
} from './schemas/index.js';
export type {
  ApiError,
  ApiSuccess,
  AuditNotification,
  CurrentUserResponse,
  HealthResponse,
  JobStatus,
  LoginRequest,
  LoginResponse,
  Pagination,
  ReadinessResponse,
} from './types/api.js';

export const SHARED_PACKAGE_NAME = '@portal/shared';
