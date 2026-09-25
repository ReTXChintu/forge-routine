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

/** Asked of the runtime rather than matched against a list that would go stale. */
function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    API_PORT: z.coerce.number().int().min(1).max(65_535).default(50005),
    API_HOST: z.string().default('0.0.0.0'),
    API_GLOBAL_PREFIX: z.string().default('api'),
    CORS_ORIGINS: z.string().default('http://localhost:50004'),

    /**
     * The zone every "today" is measured in — an IANA name like Asia/Kolkata.
     *
     * Explicit rather than taken from the host, because the host is usually
     * UTC and the user is not. Getting this wrong does not throw; it silently
     * files a Monday evening's work under Sunday, so it is validated here
     * against the zones the runtime actually knows.
     *
     * Defaults to the machine's own zone, which is what the code did before
     * this existed, so an untouched .env behaves exactly as it used to.
     */
    APP_TIMEZONE: z
      .string()
      .default(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
      .refine(isKnownTimeZone, 'APP_TIMEZONE must be an IANA zone name, e.g. Asia/Kolkata'),

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

    /**
     * AI is per user. There is no server vendor and no server key.
     *
     * Every model call is billed to a key its own user saved in Settings,
     * which is why nothing below names a vendor: the server supplies the
     * envelope — how long to wait, how often to retry, how much anyone may
     * spend in a day — and the user supplies who answers.
     */
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    /** Hard ceiling per user per day, across whichever vendor they chose. */
    AI_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(200_000),
    /**
     * Encrypts the vendor keys users save in Settings.
     *
     * Load-bearing rather than optional: with no server key, this is the
     * only thing that makes AI possible at all. Without it the settings
     * screen is read-only and every agent falls back.
     *
     * Changing it does not migrate anything — every stored key becomes
     * undecryptable and has to be re-entered. Generate once, per
     * deployment, with `openssl rand -base64 32`.
     */
    ENCRYPTION_KEY: z.string().default(''),

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
    // The inline driver is allowed in production, with a bound.
    //
    // It used to be forbidden, on the grounds that it would "block API
    // workers". That was never quite true: inline spawns a sandbox child
    // process and awaits it, which is async I/O, not event-loop work. The
    // real risk is that inline had no backpressure — N simultaneous
    // submissions meant N child processes, each allowed
    // EXECUTION_MAX_MEMORY_MB, and nothing to stop them.
    //
    // InlineExecutionAdapter now honours EXECUTION_CONCURRENCY the same way
    // the queue workers do, so the bound exists either way and the driver
    // choice is about topology rather than safety. Requiring Redis and a
    // second process for a handful of users was infrastructure with no user
    // benefit.
    //
    // What is still checked is that the bound is sane: a high concurrency
    // with a single API process is the OOM the old rule was really guarding
    // against.
    if (env.EXECUTION_DRIVER === 'inline') {
      const worstCaseMb = env.EXECUTION_CONCURRENCY * env.EXECUTION_MAX_MEMORY_MB;

      if (worstCaseMb > 1_024) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EXECUTION_CONCURRENCY'],
          message:
            `EXECUTION_CONCURRENCY × EXECUTION_MAX_MEMORY_MB is ${worstCaseMb}MB of sandboxes ` +
            'alongside the API in one process tree. Lower one of them, or use the queue driver ' +
            'and run apps/sandbox on its own.',
        });
      }
    }
    // Required in production, not merely well-formed. Without it nobody
    // can save a key, and with no server key that leaves the deployment
    // with no route to a model at all. Refusing at boot, where an operator
    // is watching, beats a settings screen that will not accept a key.
    if (env.ENCRYPTION_KEY.trim().length < 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_KEY'],
        message:
          'ENCRYPTION_KEY must be at least 16 characters — it encrypts the API keys users ' +
          'save in Settings. Generate one with `openssl rand -base64 32`.',
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
