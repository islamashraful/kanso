import { z } from 'zod';

/**
 * The request contract for authentication. Single source of truth: these
 * schemas drive runtime validation, the TypeScript types below via z.infer,
 * and the OpenAPI spec in week 2. See docs/adr/0005.
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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
