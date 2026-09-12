import { z } from 'zod';

/**
 * The single place `process.env` is read (§45.10).
 *
 * Everything is parsed and validated once at boot. A misconfigured deployment fails
 * immediately with a readable message rather than throwing somewhere deep in a request
 * three hours later.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

const durationString = z.string().regex(/^\d+[smhd]$/, 'Expected a duration like 15m, 24h, 30d');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    API_HOST: z.string().default('0.0.0.0'),
    API_GLOBAL_PREFIX: z.string().default('api'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),

    DATABASE_URL: z.string().url().startsWith('postgres'),
    DIRECT_DATABASE_URL: z.string().url().optional().or(z.literal('')),

    REDIS_URL: z.string().default('redis://localhost:6379'),
    REDIS_KEY_PREFIX: z.string().default('forgeroutine:'),
    REDIS_ENABLED: booleanish.default(false),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: durationString.default('15m'),
    JWT_REFRESH_TTL: durationString.default('30d'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    AI_PROVIDER: z.literal('openai').default('openai'),
    OPENAI_API_KEY: z.string().default(''),
    OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
    OPENAI_MODEL_FAST: z.string().default('gpt-4o-mini'),
    OPENAI_MODEL_REASONING: z.string().default('gpt-4o'),
    OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(200_000),

    EXECUTION_DRIVER: z.enum(['inline', 'queue']).default('inline'),
    EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
    EXECUTION_MAX_MEMORY_MB: z.coerce.number().int().min(32).max(2_048).default(128),
    EXECUTION_MAX_OUTPUT_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(65_536),
    EXECUTION_WORK_DIR: z.string().default('.sandbox-runs'),
    EXECUTION_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    // Production-only invariants. Catching these at boot is much cheaper than
    // discovering them from a security incident or a stalled event loop.
    if (env.JWT_ACCESS_SECRET.includes('change-me')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'Default JWT secret must not be used in production',
      });
    }
    if (env.JWT_REFRESH_SECRET.includes('change-me')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'Default JWT secret must not be used in production',
      });
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'Access and refresh secrets must differ',
      });
    }
    if (env.EXECUTION_DRIVER === 'inline') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXECUTION_DRIVER'],
        message:
          'EXECUTION_DRIVER must be "queue" in production so code execution cannot block API workers',
      });
    }
    if (env.EXECUTION_DRIVER === 'queue' && !env.REDIS_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_ENABLED'],
        message: 'The queue execution driver requires Redis',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
