import { z } from 'zod';

import { PASSWORD_MAX_LENGTH, PERMISSIONS, USER_ROLES } from '../constants.js';
import { apiMetaSchema } from './common.js';

export { PASSWORD_MAX_LENGTH, PERMISSIONS, USER_ROLES };
const EMAIL_MAX_LENGTH = 254;

export const userRoleSchema = z.enum(USER_ROLES);
export const permissionSchema = z.enum(PERMISSIONS);

// Trim and lowercase before validating so the stored identifier is canonical.
export const emailSchema = z.string().trim().toLowerCase().max(EMAIL_MAX_LENGTH).pipe(z.email());

const passwordInputSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

export const authenticatedUserSchema = z
  .object({
    id: z.string().min(1).max(128),
    email: emailSchema,
    role: userRoleSchema,
    permissions: z.array(permissionSchema).max(PERMISSIONS.length),
    passwordChangeRequired: z.boolean(),
  })
  .strict();

export const loginRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordInputSchema,
  })
  .strict();

export const changePasswordRequestSchema = z
  .object({
    currentPassword: passwordInputSchema,
    newPassword: passwordInputSchema,
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
