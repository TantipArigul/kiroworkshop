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
  jobCancelResponseSchema,
  jobDetailSchema,
  jobInputFileSchema,
  jobListSchema,
  jobOutputsSummarySchema,
  jobParametersSchema,
  jobProgressSchema,
  jobRunInfoSchema,
  jobStatusHistoryItemSchema,
  jobStatusSchema,
  jobSubmitRequestSchema,
  jobSubmitResponseSchema,
  jobSummarySchema,
  loginRequestSchema,
  loginResponseSchema,
  paginationSchema,
  permissionSchema,
  pipelineDetailSchema,
  pipelineExecutorSchema,
  pipelineIdSchema,
  pipelineLimitsSchema,
  pipelineListSchema,
  pipelineOptionDescriptorSchema,
  pipelineSummarySchema,
  pipelineUnavailableReasonSchema,
  readinessResponseSchema,
  renamefastqKitNameSchema,
  renamefastqOptionsSchema,
  runInputFileKindSchema,
  runInputLayoutSchema,
  runLaunchFieldsSchema,
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

// Pipeline Catalog & Nextflow Executor
export type JobCancelResponse = z.infer<typeof jobCancelResponseSchema>;
export type JobOutputsSummary = z.infer<typeof jobOutputsSummarySchema>;
export type JobProgress = z.infer<typeof jobProgressSchema>;
export type JobRunInfo = z.infer<typeof jobRunInfoSchema>;
export type PipelineDetail = z.infer<typeof pipelineDetailSchema>;
export type PipelineExecutor = z.infer<typeof pipelineExecutorSchema>;
export type PipelineId = z.infer<typeof pipelineIdSchema>;
export type PipelineLimits = z.infer<typeof pipelineLimitsSchema>;
export type PipelineList = z.infer<typeof pipelineListSchema>;
export type PipelineOptionDescriptor = z.infer<typeof pipelineOptionDescriptorSchema>;
export type PipelineSummary = z.infer<typeof pipelineSummarySchema>;
export type PipelineUnavailableReason = z.infer<typeof pipelineUnavailableReasonSchema>;
export type RenamefastqKitName = z.infer<typeof renamefastqKitNameSchema>;
/** Options after parsing (defaults applied). */
export type RenamefastqOptions = z.output<typeof renamefastqOptionsSchema>;
export type RenamefastqOptionsInput = z.input<typeof renamefastqOptionsSchema>;
export type RunInputFileKind = z.infer<typeof runInputFileKindSchema>;
export type RunInputLayout = z.infer<typeof runInputLayoutSchema>;
/** Raw multipart text fields of a launch request. */
export type RunLaunchFieldsInput = z.input<typeof runLaunchFieldsSchema>;
export type RunLaunchFields = z.output<typeof runLaunchFieldsSchema>;

export type ApiSuccess<T> = {
  data: T;
  meta: {
    requestId: string;
  };
};
