import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  const [tech, concepts, ex, cases, users, attempts, skills] = await Promise.all([
    p.technology.count(), p.concept.count(), p.exercise.count(),
    p.exerciseTestCase.count(), p.user.count(),
    p.exerciseAttempt.count(), p.skill.count(),
  ]);
  console.log('technologies:', tech);
  console.log('concepts:    ', concepts);
  console.log('exercises:   ', ex);
  console.log('test cases:  ', cases);
  console.log('users:       ', users);
  console.log('attempts:    ', attempts);
  console.log('skills:      ', skills);
  const applied = await p.$queryRaw`SELECT migration_name FROM _prisma_migrations ORDER BY finished_at`;
  console.log('migrations applied:', applied.map(r => r.migration_name).join(', '));
} catch (e) {
  console.error('ERROR:', e.message.split('\n')[0]);
} finally { await p.$disconnect(); }
