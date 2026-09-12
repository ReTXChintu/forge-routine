import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const rows = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  console.log('Reachable. Existing public tables:', rows.length);
  for (const r of rows) console.log('  -', r.tablename);
} catch (e) {
  console.error('FAILED:', e.message.split('\n').slice(0, 3).join(' | '));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
