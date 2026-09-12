import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const slug = process.argv[2] ?? 'docker';
const t = await p.technology.findUnique({ where: { slug } });
const [concepts, questions, exercises, edges, version] = await Promise.all([
  p.concept.count({ where: { technologyId: t.id } }),
  p.conceptQuestion.count({ where: { concept: { technologyId: t.id } } }),
  p.exercise.count({ where: { concept: { technologyId: t.id } } }),
  p.conceptPrerequisite.count({ where: { concept: { technologyId: t.id } } }),
  p.curriculumVersion.findFirst({ where: { technologyId: t.id, status: 'ACTIVE' } }),
]);
console.log(`${t.name} (exerciseLanguage: ${t.exerciseLanguage ?? 'null'})`);
console.log('  concepts: ', concepts);
console.log('  exercises:', exercises);
console.log('  questions:', questions);
console.log('  edges:    ', edges);
console.log('  version:  ', version ? `v${version.version} ${version.status} by ${version.generatorVersion}` : 'none');
await p.$disconnect();
