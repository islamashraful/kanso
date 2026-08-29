import { z } from 'zod';

/**
 * The shape of every environment variable this application reads.
 *
 * This is the only place in the codebase that touches `process.env`. Everything
 * else imports the parsed `config` object below, so a missing or malformed
 * variable fails at boot with a clear message rather than surfacing as
 * `undefined` somewhere in a request handler.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),

  // Required, not defaulted: the notifications queue needs Redis to be
  // reachable, and a missing setting should fail at boot rather than on the
  // first request that tries to enqueue a job.
  REDIS_URL: z.url(),

  // 32 bytes is the HS256 block size: a shorter key weakens the signature
  // without any error to say so, which is why the length is checked here
  // rather than trusted. See docs/adr/0011.
  JWT_SECRET: z.string().min(32, 'Must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Task attachments. S3_ENDPOINT/S3_FORCE_PATH_STYLE point the client at
  // MinIO in dev and test; both are unset in production, where the AWS SDK
  // resolves the real S3 endpoint itself and virtual-hosted-style addressing
  // applies. See docs/adr/0018.
  S3_BUCKET: z.string(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
});

export type Config = Readonly<z.infer<typeof envSchema>>;

/**
 * Parse and validate an environment. Takes the environment as an argument
 * rather than reading `process.env` directly, so it can be exported and tested
 * against arbitrary input once a test for it exists.
 */
const parseEnv = (env: Record<string, string | undefined>): Config => {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return Object.freeze(result.data);
};

export const config = parseEnv(process.env);
