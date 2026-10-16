import { apiErrorSchema, type ErrorCode } from '@portal/shared';

export type ApiErrorCode = ErrorCode;

export type ApiErrorDetail = {
  field?: string;
  message: string;
};

export class HttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: readonly ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function createErrorResponse(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details: readonly ApiErrorDetail[] = [],
) {
  return apiErrorSchema.parse({
    error: {
      code,
      message,
      details,
    },
    meta: { requestId },
  });
}
