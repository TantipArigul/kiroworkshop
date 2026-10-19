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

/** Safe default message of `410 GONE` (Results & Guidance API Specification). */
export const GONE_MESSAGE =
  'The result files were removed by the retention policy or are no longer available.';

/**
 * `410 GONE`: the record still exists but its files were removed (retention) or are missing.
 * Handled by the error middleware like every other `HttpError`; never carries a path.
 */
export class GoneError extends HttpError {
  public constructor(message: string = GONE_MESSAGE) {
    super(410, 'GONE', message);
    this.name = 'GoneError';
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
