import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export { PrismaClient };

export interface PrismaClientOptions {
  databaseUrl?: string;
  logQueries?: boolean;
}

/**
 * Process-wide Prisma singleton.
 *
 * Under `tsx`/Vite HMR a new client would be constructed on every reload, and each one
 * opens its own connection pool until Postgres refuses new connections. Stashing it on
 * `globalThis` outside production is the standard remedy.
 */
const globalForPrisma = globalThis as unknown as { __forgeroutinePrisma?: PrismaClient };

export function createPrismaClient(options: PrismaClientOptions = {}): PrismaClient {
  return new PrismaClient({
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
    ...(options.databaseUrl ? { datasources: { db: { url: options.databaseUrl } } } : {}),
  });
}

export function getPrismaClient(options: PrismaClientOptions = {}): PrismaClient {
  if (process.env.NODE_ENV === 'production') {
    return createPrismaClient(options);
  }
  globalForPrisma.__forgeroutinePrisma ??= createPrismaClient(options);
  return globalForPrisma.__forgeroutinePrisma;
}

/** Cheap liveness probe used by `GET /health/ready`. */
export async function checkDatabaseConnection(client: PrismaClient): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
