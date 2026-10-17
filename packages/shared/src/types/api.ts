import type { z } from 'zod';

import type {
  apiErrorSchema,
  auditEventListResponseSchema,
  auditEventQuerySchema,
  auditEventSchema,
  auditEventTypeSchema,
  auditNotificationSchema,
  auditOutcomeSchema,
  auditResourceTypeSchema,
  authenticatedUserSchema,
  changePasswordRequestSchema,
  currentUserResponseSchema,
  errorCodeSchema,
  healthResponseSchema,
  inputMarkerNameSchema,
  jobDetailSchema,
  jobInputFileSchema,
  jobListSchema,
  jobParametersSchema,
  jobStatusHistoryItemSchema,
  jobStatusSchema,
  jobSubmitRequestSchema,
  jobSubmitResponseSchema,
  jobSummarySchema,
  loginRequestSchema,
  loginResponseSchema,
  paginationSchema,
  permissionSchema,
  readinessResponseSchema,
  sampleInputSchema,
  userRoleSchema,
} from '../schemas/index.js';

export type ApiError = z.infer<typeof apiErrorSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditEventListResponse = z.infer<typeof auditEventListResponseSchema>;
export type AuditEventQuery = z.infer<typeof auditEventQuerySchema>;
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;
export type AuditNotification = z.infer<typeof auditNotificationSchema>;
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;
export type AuditResourceType = z.infer<typeof auditResourceTypeSchema>;
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type CurrentUserResponse = z.infer<typeof currentUserResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type InputMarkerName = z.infer<typeof inputMarkerNameSchema>;
export type JobDetail = z.infer<typeof jobDetailSchema>;
export type JobInputFile = z.infer<typeof jobInputFileSchema>;
export type JobList = z.infer<typeof jobListSchema>;
/** Parameters after parsing (defaults applied). */
export type JobParameters = z.output<typeof jobParametersSchema>;
export type JobStatusHistoryItem = z.infer<typeof jobStatusHistoryItemSchema>;
export type JobSubmitRequest = z.input<typeof jobSubmitRequestSchema>;
export type JobSubmitResponse = z.infer<typeof jobSubmitResponseSchema>;
export type JobSummary = z.infer<typeof jobSummarySchema>;
export type SampleInput = z.infer<typeof sampleInputSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type Permission = z.infer<typeof permissionSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;

export type ApiSuccess<T> = {
  data: T;
  meta: {
    requestId: string;
  };
};
