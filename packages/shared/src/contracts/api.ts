import { apiMetaSchema } from '../schemas/index.js';

import type { ApiSuccess } from '../types/api.js';

export function createSuccessResponse<T>(data: T, requestId: string): ApiSuccess<T> {
  const meta = apiMetaSchema.parse({ requestId });

  return { data, meta };
}
