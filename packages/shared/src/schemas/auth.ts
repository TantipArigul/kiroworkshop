import { z } from 'zod';

import { apiMetaSchema } from './common.js';

export const userRoleSchema = z.enum(['USER', 'ADMIN']);

export const authenticatedUserSchema = z
  .object({
    id: z.string().min(1).max(128),
    username: z.string().min(1).max(64),
    role: userRoleSchema,
  })
  .strict();

export const loginRequestSchema = z
  .object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(1024),
  })
  .strict();

export const csrfTokenResponseSchema = z
  .object({
    data: z
      .object({
        csrfToken: z.string().min(16),
      })
      .strict(),
    meta: apiMetaSchema,
  })
  .strict();

export const loginResponseSchema = z
  .object({
    data: z
      .object({
        user: authenticatedUserSchema,
        csrfToken: z.string().min(16),
      })
      .strict(),
    meta: apiMetaSchema,
  })
  .strict();

export const currentUserResponseSchema = z
  .object({
    data: authenticatedUserSchema,
    meta: apiMetaSchema,
  })
  .strict();
