import type { z } from 'zod';

import type {
  apiErrorSchema,
  auditNotificationSchema,
  currentUserResponseSchema,
  healthResponseSchema,
  jobStatusSchema,
  loginRequestSchema,
  loginResponseSchema,
  paginationSchema,
  readinessResponseSchema,
} from '../schemas/index.js';

export type ApiError = z.infer<typeof apiErrorSchema>;
export type AuditNotification = z.infer<typeof auditNotificationSchema>;
export type CurrentUserResponse = z.infer<typeof currentUserResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export type ApiSuccess<T> = {
  data: T;
  meta: {
    requestId: string;
  };
};
