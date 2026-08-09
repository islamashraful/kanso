import { z } from 'zod';

/**
 * The request contract for authentication. Single source of truth: these
 * schemas drive runtime validation, the TypeScript types below via z.infer,
 * and the OpenAPI document. See docs/adr/0005 and docs/adr/0015.
 */
export const registerSchema = z.object({
  email: z.email('Not a valid email address').trim().toLowerCase(),
  // Length is the only rule. Composition requirements (a digit, a symbol) push
  // users toward shorter, more predictable passwords, and NIST dropped them.
  password: z.string().min(12, 'Must be at least 12 characters').max(128),
  name: z.string().trim().min(1, 'Name is required').max(100),
});

export const loginSchema = z.object({
  email: z.email('Not a valid email address').trim().toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

/**
 * What authentication returns. The user is deliberately three fields: the
 * password hash and the timestamps have no business leaving the service, so
 * the response schema is not the model with fields removed but its own shape.
 */
export const authUserSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
  })
  .meta({ id: 'AuthUser' });

export const tokenPairSchema = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
  })
  .meta({ id: 'TokenPair' });

export const authResponseSchema = tokenPairSchema
  .extend({ user: authUserSchema })
  .meta({ id: 'AuthResponse' });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
