import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

for (const slug of ['typescript', 'docker', 'react']) {
  const t = await p.technology.findUnique({ where: { slug } });
  const [live, archived, ex, q, edges] = await Promise.all([
    p.concept.count({ where: { technologyId: t.id, archivedAt: null } }),
    p.concept.count({ where: { technologyId: t.id, archivedAt: { not: null } } }),
    p.exercise.count({ where: { concept: { technologyId: t.id } } }),
    p.conceptQuestion.count({ where: { concept: { technologyId: t.id } } }),
    p.conceptPrerequisite.count({ where: { concept: { technologyId: t.id } } }),
  ]);
  console.log(
    `${t.name.padEnd(12)} lang=${String(t.exerciseLanguage).padEnd(10)} ` +
      `concepts=${live} (archived ${archived})  exercises=${ex}  questions=${q}  edges=${edges}`,
  );
}

// Every persisted exercise must have a reference solution and hidden tests.
const bad = await p.exercise.findMany({
  where: { referenceSolution: null },
  select: { slug: true },
});
console.log('\nexercises with no reference solution:', bad.length);

const generated = await p.exercise.findMany({
  where: { concept: { technology: { slug: 'typescript' } } },
  include: { testCases: true },
});
for (const e of generated) {
  const hidden = e.testCases.filter((t) => t.hidden).length;
  const startsRight = e.referenceSolution?.trimStart().startsWith('export default');
  console.log(
    `  ${e.slug.padEnd(34)} ${e.testCases.length} tests (${hidden} hidden)  ` +
      `refSolution starts with export default: ${startsRight}`,
  );
}
await p.$disconnect();
