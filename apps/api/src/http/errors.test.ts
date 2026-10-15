import { describe, expect, it } from 'vitest';

import { createErrorResponse, HttpError } from './errors.js';

describe('safe API errors', () => {
  it('creates a strict safe error envelope without an internal stack', () => {
    expect(
      createErrorResponse(
        'INTERNAL_ERROR',
        'Unable to complete the request.',
        '46d1f548-322b-41d6-b67f-3876622e1b63',
      ),
    ).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unable to complete the request.',
        details: [],
      },
      meta: { requestId: '46d1f548-322b-41d6-b67f-3876622e1b63' },
    });
  });

  it('retains only a safe client message on expected HTTP errors', () => {
    const error = new HttpError(403, 'CSRF_INVALID', 'Request validation failed.');

    expect(error.status).toBe(403);
    expect(error.code).toBe('CSRF_INVALID');
    expect(error.message).not.toContain('token-value');
  });
});
