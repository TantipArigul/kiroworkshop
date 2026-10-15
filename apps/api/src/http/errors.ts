import { apiErrorSchema } from '@portal/shared';

export type ApiErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHORIZATION_DENIED'
  | 'CSRF_INVALID'
  | 'INTERNAL_ERROR'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED'
  | 'RATE_LIMITED'
  | 'VALIDATION_FAILED';

export class HttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function createErrorResponse(code: ApiErrorCode, message: string, requestId: string) {
  return apiErrorSchema.parse({
    error: {
      code,
      message,
      details: [],
    },
    meta: { requestId },
  });
}
