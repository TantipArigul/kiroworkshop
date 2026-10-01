import { z } from 'zod';

import { apiMetaSchema } from './common.js';

export const healthResponseSchema = z
  .object({
    data: z
      .object({
        status: z.literal('ok'),
        uptimeSeconds: z.number().nonnegative(),
        version: z.string().min(1),
      })
      .strict(),
    meta: apiMetaSchema,
  })
  .strict();

export const readinessResponseSchema = z
  .object({
    data: z
      .object({
        status: z.enum(['ready', 'not_ready']),
        checks: z.record(z.string(), z.enum(['ok', 'failed'])),
      })
      .strict(),
    meta: apiMetaSchema,
  })
  .strict();
