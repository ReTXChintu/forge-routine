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
 */
export const TECHNOLOGY_CATALOGUE: Omit<SeedTechnologyInput, 'concepts'>[] = [
  {
    slug: 'javascript',
    exerciseLanguage: 'javascript',
    name: 'JavaScript',
    description: 'The language underneath everything else in the stack.',
    category: 'language',
  },
  {
    slug: 'typescript',
    exerciseLanguage: 'javascript',
    name: 'TypeScript',
    description: 'Static types over JavaScript.',
    category: 'language',
  },
  {
    slug: 'nodejs',
    exerciseLanguage: 'javascript',
    name: 'Node.js',
    description: 'Server-side JavaScript runtime: the event loop, streams, and I/O.',
    category: 'runtime',
  },
  {
    slug: 'react',
    exerciseLanguage: null,
    name: 'React',
    description: 'Component model, hooks, rendering, and state.',
    category: 'frontend',
  },
  {
    slug: 'nextjs',
    exerciseLanguage: null,
    name: 'Next.js',
    description: 'React framework: routing, rendering strategies, and the server boundary.',
    category: 'frontend',
  },
  {
    slug: 'nestjs',
    exerciseLanguage: null,
    name: 'NestJS',
    description: 'Structured Node.js framework: modules, DI, and layered architecture.',
    category: 'backend',
  },
  {
    slug: 'mongodb',
    exerciseLanguage: null,
    name: 'MongoDB',
    description: 'Document database: schema design, aggregation, and indexes.',
    category: 'database',
  },
  {
    slug: 'postgresql',
    exerciseLanguage: null,
    name: 'PostgreSQL',
    description: 'Relational database: SQL, transactions, indexes, and query planning.',
    category: 'database',
  },
  {
    slug: 'prisma',
    exerciseLanguage: null,
    name: 'Prisma',
    description: 'Type-safe database toolkit: schema, migrations, and the client.',
    category: 'database',
  },
  {
    slug: 'docker',
    exerciseLanguage: null,
    name: 'Docker',
    description: 'Containers: images, layers, networking, and volumes.',
    category: 'devops',
  },
  {
    slug: 'linux',
    exerciseLanguage: null,
    name: 'Linux',
    description: 'Processes, filesystem, permissions, networking, and troubleshooting.',
    category: 'systems',
  },
  {
    slug: 'git',
    exerciseLanguage: null,
    name: 'Git',
    description: 'Version control: the object model, branching, and history surgery.',
    category: 'tooling',
  },
  {
    slug: 'github',
    exerciseLanguage: null,
    name: 'GitHub',
    description: 'Collaboration: pull requests, reviews, and repository configuration.',
    category: 'tooling',
  },
  {
    slug: 'github-actions',
    exerciseLanguage: null,
    name: 'GitHub Actions',
    description: 'CI/CD: workflows, jobs, caching, and deployment pipelines.',
    category: 'devops',
  },
  {
    slug: 'jenkins',
    exerciseLanguage: null,
    name: 'Jenkins',
    description: 'Pipelines, agents, and build orchestration.',
    category: 'devops',
  },
  {
    slug: 'redis',
    exerciseLanguage: null,
    name: 'Redis',
    description: 'In-memory data structures: caching, queues, and rate limiting.',
    category: 'database',
  },
  {
    slug: 'nginx',
    exerciseLanguage: null,
    name: 'Nginx',
    description: 'Reverse proxy, TLS termination, static serving, and load balancing.',
    category: 'infrastructure',
  },
  {
    slug: 'traefik',
    exerciseLanguage: null,
    name: 'Traefik',
    description: 'Dynamic reverse proxy and routing.',
    category: 'infrastructure',
  },
  {
    slug: 'system-design',
    exerciseLanguage: null,
    name: 'System Design',
    description: 'Scaling, consistency, caching, queues, and trade-offs.',
    category: 'architecture',
  },
];
