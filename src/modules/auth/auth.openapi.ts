import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { errorResponse, jsonResponse } from '@/openapi/components';

import {
  authResponseSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  tokenPairSchema,
} from './auth.schema';

/**
 * Documents the auth routes. See docs/adr/0015.
 *
 * The only paths with no security requirement, declared as `security: []`:
 * they are how a caller obtains the credentials every other path demands.
 */
export const authPaths: ZodOpenApiPathsObject = {
  '/api/v1/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Create an account',
      security: [],
      requestBody: { content: { 'application/json': { schema: registerSchema } } },
      responses: {
        201: jsonResponse('Account created, tokens issued.', authResponseSchema),
        409: errorResponse('Email already registered.'),
        422: errorResponse('Validation failed.'),
      },
    },
  },

  '/api/v1/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Exchange credentials for tokens',
      security: [],
      requestBody: { content: { 'application/json': { schema: loginSchema } } },
      responses: {
        200: jsonResponse('Tokens issued.', authResponseSchema),
        401: errorResponse(
          'Email or password is wrong. The two are not distinguished, so the response does not reveal whether the address is registered.',
        ),
        422: errorResponse('Validation failed.'),
      },
    },
  },

  '/api/v1/auth/refresh': {
    post: {
      tags: ['Auth'],
      summary: 'Rotate a refresh token',
      description:
        'Returns a new pair and invalidates the one presented. Presenting a rotated token a second time is recognised as reuse rather than merely unknown. See docs/adr/0011.',
      security: [],
      requestBody: { content: { 'application/json': { schema: refreshSchema } } },
      responses: {
        200: jsonResponse('A new token pair.', tokenPairSchema),
        401: errorResponse('Token is unknown, expired, revoked, or already used.'),
        422: errorResponse('Validation failed.'),
      },
    },
  },

  '/api/v1/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Revoke a refresh token',
      security: [],
      requestBody: { content: { 'application/json': { schema: refreshSchema } } },
      responses: {
        204: { description: 'Revoked. Returns nothing, and succeeds even for an unknown token.' },
        422: errorResponse('Validation failed.'),
      },
    },
  },
};
