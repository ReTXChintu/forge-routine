import type { SeedTechnologyInput } from './types.js';

/**
 * The §41 starting catalogue.
 *
 * This is *data*. No part of the application branches on these slugs — adding Rust
 * or Kubernetes is a row, not a release (§45.13). Technologies listed here without a
 * curated concept graph get one generated on first use.
 */
export const TECHNOLOGY_CATALOGUE: Omit<SeedTechnologyInput, 'concepts'>[] = [
  {
    slug: 'javascript',
    name: 'JavaScript',
    description: 'The language underneath everything else in the stack.',
    category: 'language',
  },
  {
    slug: 'typescript',
    name: 'TypeScript',
    description: 'Static types over JavaScript.',
    category: 'language',
  },
  {
    slug: 'nodejs',
    name: 'Node.js',
    description: 'Server-side JavaScript runtime: the event loop, streams, and I/O.',
    category: 'runtime',
  },
  {
    slug: 'react',
    name: 'React',
    description: 'Component model, hooks, rendering, and state.',
    category: 'frontend',
  },
  {
    slug: 'nextjs',
    name: 'Next.js',
    description: 'React framework: routing, rendering strategies, and the server boundary.',
    category: 'frontend',
  },
  {
    slug: 'nestjs',
    name: 'NestJS',
    description: 'Structured Node.js framework: modules, DI, and layered architecture.',
    category: 'backend',
  },
  {
    slug: 'mongodb',
    name: 'MongoDB',
    description: 'Document database: schema design, aggregation, and indexes.',
    category: 'database',
  },
  {
    slug: 'postgresql',
    name: 'PostgreSQL',
    description: 'Relational database: SQL, transactions, indexes, and query planning.',
    category: 'database',
  },
  {
    slug: 'prisma',
    name: 'Prisma',
    description: 'Type-safe database toolkit: schema, migrations, and the client.',
    category: 'database',
  },
  {
    slug: 'docker',
    name: 'Docker',
    description: 'Containers: images, layers, networking, and volumes.',
    category: 'devops',
  },
  {
    slug: 'linux',
    name: 'Linux',
    description: 'Processes, filesystem, permissions, networking, and troubleshooting.',
    category: 'systems',
  },
  {
    slug: 'git',
    name: 'Git',
    description: 'Version control: the object model, branching, and history surgery.',
    category: 'tooling',
  },
  {
    slug: 'github',
    name: 'GitHub',
    description: 'Collaboration: pull requests, reviews, and repository configuration.',
    category: 'tooling',
  },
  {
    slug: 'github-actions',
    name: 'GitHub Actions',
    description: 'CI/CD: workflows, jobs, caching, and deployment pipelines.',
    category: 'devops',
  },
  {
    slug: 'jenkins',
    name: 'Jenkins',
    description: 'Pipelines, agents, and build orchestration.',
    category: 'devops',
  },
  {
    slug: 'redis',
    name: 'Redis',
    description: 'In-memory data structures: caching, queues, and rate limiting.',
    category: 'database',
  },
  {
    slug: 'nginx',
    name: 'Nginx',
    description: 'Reverse proxy, TLS termination, static serving, and load balancing.',
    category: 'infrastructure',
  },
  {
    slug: 'traefik',
    name: 'Traefik',
    description: 'Dynamic reverse proxy and routing.',
    category: 'infrastructure',
  },
  {
    slug: 'system-design',
    name: 'System Design',
    description: 'Scaling, consistency, caching, queues, and trade-offs.',
    category: 'architecture',
  },
];
