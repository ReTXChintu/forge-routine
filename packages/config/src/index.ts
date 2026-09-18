import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import { type Env, envSchema } from './env.js';

export { envSchema, type Env } from './env.js';

export class ConfigurationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigurationError';
  }
}

/**
 * Walk up from `startDir` looking for the repo root `.env`.
 * Apps run from their own directory but share one root env file, so a plain
 * `dotenv.config()` relative to cwd would silently find nothing.
 */
function findEnvFile(startDir: string): string | null {
  let dir = startDir;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let cached: AppConfig | null = null;

export interface AppConfig {
  env: Env;
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
  corsOrigins: string[];
  /** True only when a key is actually present; agents fall back when false. */
  aiEnabled: boolean;
  /** Whether users may save their own vendor keys — needs ENCRYPTION_KEY. */
  secretsEnabled: boolean;
  databaseUrlForMigrations: string;
}

export function loadConfig(options: { reload?: boolean; cwd?: string } = {}): AppConfig {
  if (cached && !options.reload) return cached;

  const envFile = findEnvFile(options.cwd ?? process.cwd());
  if (envFile) loadDotenv({ path: envFile });

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }

  const env = parsed.data;

  cached = {
    env,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    // Both the switch and a key, deliberately: a key without the switch is
    // someone who has paused spending, a switch without a key is someone
    // who has not finished setting up, and neither should produce a call.
    // Any vendor's key counts — a deployment configured for Claude alone
    // must not read as "AI is off" for want of an OpenAI key.
    aiEnabled:
      env.AI_ENABLED &&
      [env.OPENAI_API_KEY, env.ANTHROPIC_API_KEY, env.GEMINI_API_KEY].some(
        (key) => key.trim().length > 0,
      ),
    /** Whether users can save their own vendor keys. Needs somewhere safe to put them. */
    secretsEnabled: env.ENCRYPTION_KEY.trim().length >= 16,
    databaseUrlForMigrations:
      env.DIRECT_DATABASE_URL && env.DIRECT_DATABASE_URL.length > 0
        ? env.DIRECT_DATABASE_URL
        : env.DATABASE_URL,
  };

  return cached;
}

/** Test helper. Never call this from application code. */
export function resetConfigCache(): void {
  cached = null;
}
