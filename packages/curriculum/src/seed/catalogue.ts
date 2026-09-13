import type { SeedTechnologyInput } from './types.js';

/**
 * The §41 starting catalogue.
 *
 * This is *data*. No part of the application branches on these slugs — adding Rust
 * or Kubernetes is a row, not a release (§45.13). Technologies listed here without a
 * curated concept graph get one generated on first use.
 *
 * `exerciseLanguage` says whether the sandbox can actually execute this
 * technology's exercises. Only plain-ESM JavaScript qualifies today:
 *
 *   - React and Next.js need a JSX transform and a React runtime. Generation
 *     was tried and every exercise was rejected by the verifier with
 *     `Unexpected token '<'`, which is the correct outcome but a waste of
 *     tokens, so they are tagged null up front.
 *   - NestJS needs decorators and a DI container.
 *   - Docker, Linux, SQL and the rest cannot be graded by running JavaScript
 *     at all.
 *
 * Null does not mean unteachable. Those technologies get concept questions,
 * which is honest practice rather than exercises that cannot run.
 *
 * `dependsOn` is the learning order, hand-authored. It decides which
 * technology's curriculum is generated first and which phase the roadmap
 * opens on. It is deliberately *not* inferred: the generator can propose
 * cross-technology prerequisites, but only after both sides already exist,
 * which is too late to decide what to build first and pays a model to answer
 * a question we already know the answer to.
 *
 * Only genuine prerequisites belong here. "Useful alongside" is not a
 * dependency, and over-constraining the graph forces people through material
 * they did not ask for.
 *
 * `learningOrder` is the intended reading sequence. Dependencies alone leave
 * most pairs unordered, and sorting on them alone scatters the JavaScript
 * chain through the DevOps one — a valid order and a bad curriculum. So
 * `dependsOn` says what is forbidden and `learningOrder` says what is
 * wanted; `technology-order.test.ts` proves they never disagree.
 */
export const TECHNOLOGY_CATALOGUE: Omit<SeedTechnologyInput, 'concepts'>[] = [
  {
    slug: 'dsa',
    exerciseLanguage: 'javascript',
    name: 'DSA',
    description:
      'Data structures and algorithms. Added to every account automatically and ' +
      'practised daily rather than studied in a block.',
    category: 'foundations',
    // Nothing gates it and it gates nothing: DSA runs alongside whatever
    // else is being learned, from the first day to the last.
    dependsOn: [],
    learningOrder: 0,
  },
  {
    slug: 'javascript',
    exerciseLanguage: 'javascript',
    name: 'JavaScript',
    description: 'The language underneath everything else in the stack.',
    category: 'language',
    // Everything else in this stack sits on it.
    dependsOn: [],
    learningOrder: 1,
  },
  {
    slug: 'typescript',
    exerciseLanguage: 'javascript',
    name: 'TypeScript',
    description: 'Static types over JavaScript.',
    category: 'language',
    dependsOn: ['javascript'],
    learningOrder: 2,
  },
  {
    slug: 'nodejs',
    exerciseLanguage: 'javascript',
    name: 'Node.js',
    description: 'Server-side JavaScript runtime: the event loop, streams, and I/O.',
    category: 'runtime',
    dependsOn: ['javascript'],
    learningOrder: 5,
  },
  {
    slug: 'react',
    exerciseLanguage: null,
    name: 'React',
    description: 'Component model, hooks, rendering, and state.',
    category: 'frontend',
    // Hooks are closures. Learning React first means learning the rules
    // without the reason for them.
    dependsOn: ['javascript', 'typescript'],
    learningOrder: 10,
  },
  {
    slug: 'nextjs',
    exerciseLanguage: null,
    name: 'Next.js',
    description: 'React framework: routing, rendering strategies, and the server boundary.',
    category: 'frontend',
    dependsOn: ['react'],
    learningOrder: 11,
  },
  {
    slug: 'nestjs',
    exerciseLanguage: null,
    name: 'NestJS',
    description: 'Structured Node.js framework: modules, DI, and layered architecture.',
    category: 'backend',
    // Decorators and DI on top of both.
    dependsOn: ['typescript', 'nodejs'],
    learningOrder: 12,
  },
  {
    slug: 'mongodb',
    exerciseLanguage: null,
    name: 'MongoDB',
    description: 'Document database: schema design, aggregation, and indexes.',
    category: 'database',
    // Standalone: nothing here depends on the rest of the stack.
    dependsOn: [],
    learningOrder: 7,
  },
  {
    slug: 'postgresql',
    exerciseLanguage: null,
    name: 'PostgreSQL',
    description: 'Relational database: SQL, transactions, indexes, and query planning.',
    category: 'database',
    // Standalone: SQL is worth learning on its own terms.
    dependsOn: [],
    learningOrder: 6,
  },
  {
    slug: 'prisma',
    exerciseLanguage: null,
    name: 'Prisma',
    description: 'Type-safe database toolkit: schema, migrations, and the client.',
    category: 'database',
    // A typed client over a schema. Without SQL underneath it you are
    // learning an API, not a database.
    dependsOn: ['typescript', 'postgresql'],
    learningOrder: 8,
  },
  {
    slug: 'docker',
    exerciseLanguage: null,
    name: 'Docker',
    description: 'Containers: images, layers, networking, and volumes.',
    category: 'devops',
    // Namespaces, cgroups and the filesystem are the whole idea.
    dependsOn: ['linux'],
    learningOrder: 14,
  },
  {
    slug: 'linux',
    exerciseLanguage: null,
    name: 'Linux',
    description: 'Processes, filesystem, permissions, networking, and troubleshooting.',
    category: 'systems',
    // Underneath Docker, Nginx and every deploy.
    dependsOn: [],
    learningOrder: 4,
  },
  {
    slug: 'git',
    exerciseLanguage: null,
    name: 'Git',
    description: 'Version control: the object model, branching, and history surgery.',
    category: 'tooling',
    // Needed from the first day, depends on nothing.
    dependsOn: [],
    learningOrder: 3,
  },
  {
    slug: 'github',
    exerciseLanguage: null,
    name: 'GitHub',
    description: 'Collaboration: pull requests, reviews, and repository configuration.',
    category: 'tooling',
    dependsOn: ['git'],
    learningOrder: 17,
  },
  {
    slug: 'github-actions',
    exerciseLanguage: null,
    name: 'GitHub Actions',
    description: 'CI/CD: workflows, jobs, caching, and deployment pipelines.',
    category: 'devops',
    dependsOn: ['github', 'docker'],
    learningOrder: 18,
  },
  {
    slug: 'jenkins',
    exerciseLanguage: null,
    name: 'Jenkins',
    description: 'Pipelines, agents, and build orchestration.',
    category: 'devops',
    dependsOn: ['docker'],
    learningOrder: 19,
  },
  {
    slug: 'redis',
    exerciseLanguage: null,
    name: 'Redis',
    description: 'In-memory data structures: caching, queues, and rate limiting.',
    category: 'database',
    // Standalone: the data structures are the subject.
    dependsOn: [],
    learningOrder: 13,
  },
  {
    slug: 'nginx',
    exerciseLanguage: null,
    name: 'Nginx',
    description: 'Reverse proxy, TLS termination, static serving, and load balancing.',
    category: 'infrastructure',
    dependsOn: ['linux'],
    learningOrder: 15,
  },
  {
    slug: 'traefik',
    exerciseLanguage: null,
    name: 'Traefik',
    description: 'Dynamic reverse proxy and routing.',
    category: 'infrastructure',
    dependsOn: ['docker', 'nginx'],
    learningOrder: 16,
  },
  {
    slug: 'system-design',
    exerciseLanguage: null,
    name: 'System Design',
    description: 'Scaling, consistency, caching, queues, and trade-offs.',
    category: 'architecture',
    // No hard prerequisite, but it is ordered last deliberately: designing
    // systems is worth far more once you have built parts of one.
    dependsOn: [],
    learningOrder: 21,
  },
  {
    slug: 'typeorm',
    exerciseLanguage: null,
    name: 'TypeORM',
    description: 'Entities, relations, migrations, and the query builder.',
    category: 'database',
    // Same shape as Prisma: a typed layer over SQL you should already read.
    dependsOn: ['typescript', 'postgresql'],
    learningOrder: 9,
  },
  {
    slug: 'rust',
    exerciseLanguage: null,
    name: 'Rust',
    description: 'Ownership, borrowing, lifetimes, traits, and fearless concurrency.',
    category: 'language',
    // A separate track, not a step in the JavaScript one. It blocks nothing,
    // so it sits late: useful, but never the thing standing between you and
    // the stack you actually ship.
    dependsOn: [],
    learningOrder: 22,
  },
  {
    slug: 'software-architecture',
    exerciseLanguage: null,
    name: 'Software Architecture',
    description:
      'MVC, MVVM, layered, hexagonal and clean architecture — and when each one earns its cost.',
    category: 'architecture',
    // One subject rather than four. These patterns are understood by
    // contrast: clean architecture is a response to layered, hexagonal is a
    // response to both, and teaching them apart means each course
    // re-explains the same trade-offs without ever making the comparison.
    //
    // No hard prerequisite, but placed after the frameworks deliberately —
    // the patterns are answers to problems you have to have felt.
    dependsOn: [],
    learningOrder: 20,
  },
];
