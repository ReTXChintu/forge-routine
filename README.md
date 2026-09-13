<div align="center">

<img src="assets/brand/full-logo-480.png" alt="ForgeRoutine" width="360">

**Forge your coding skills. Build your engineering mind.**

</div>

---

## What this is

A personalised coding and engineering mastery platform whose purpose is to rebuild the
ability to write code independently, while progressively preparing for real engineering
interviews.

> AI should make the developer better at thinking and writing code,
> not replace the developer's ability to think and write code.

The problem it addresses is specific. An engineer who has paired heavily with AI can still
_reason_ — architecture, trade-offs, what the solution should look like. What decays is the
motor skill: opening an empty file and producing working code unaided.

So ForgeRoutine measures understanding and implementation **separately**, and trains the
second directly. Every feature is judged against one sentence:

> Never optimise for "the user finished the exercise."
> Optimise for "the user became capable of solving the exercise independently."

## The loop

```
ROUTINE → LEARN → RECALL → WRITE → DEBUG → EXPLAIN → INTERVIEW → EVALUATE → ADAPT → ROUTINE
```

Each stage writes evidence into the skill model; the skill model drives the next routine.
Nothing in the loop is decorative.

## What makes it different

|                                               |                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nine skill dimensions, not one percentage** | A user routinely scores 84% concept understanding and 51% implementation on the same topic. That gap _is_ the product's reason to exist, so the data model can express it.                              |
| **The assistance ladder**                     | Exercises progressively remove help across five levels, from guided to interview conditions. Level 4 gives you one line: _"Build an Express middleware that limits requests based on IP address."_      |
| **AI that withholds code**                    | The tutor prefers one question over any explanation. Below `SHOW_SOLUTION` it cannot produce code — enforced by prompt, by an output guard, and by regression tests that try to argue it into doing so. |
| **Independent Coding Score**                  | A headline number built only from facts the server observed. Client-reported signals are advisory and never scored, because a score that can be faked is worse than none.                               |
| **Blind Coding**                              | No AI, no autocomplete, no solution. Monaco's suggestions are switched off, not just ignored.                                                                                                           |
| **A knowledge graph, not a list**             | When you fail at Node.js Streams, the system asks _why_ and finds that Buffers is weak — then puts Buffers first.                                                                                       |
| **Your own learning universe**                | Add Rust today, Kubernetes next week. Technologies are data, never hardcoded. Removing one archives it; your history survives.                                                                          |

## Architecture

A **modular monolith** — one deployable API, split internally by business domain. The one
thing outside that process is user code execution, which is physically isolated.

```
apps/web        React · Vite · Chakra · Monaco · TanStack Query
apps/api        NestJS, modular hexagonal (domain / application / infrastructure / http)
apps/sandbox    Code execution workers (PM2 fork mode)
apps/mobile     Flutter — routine, review, progress, interview

packages/shared-types   Domain vocabulary. Zero runtime dependencies.
packages/validation     Zod schemas for every external boundary
packages/config         One validated read of process.env, at boot
packages/utils          Independent Coding Score, spaced repetition, scoring maths
packages/database       Prisma schema, client, seeds
packages/curriculum     Knowledge-graph algorithms and curated seed data
packages/ai             Provider port, OpenAI adapter, agents, assistance policy
packages/sandbox        The isolated code runner

ecosystem.config.cjs    PM2 process definitions (repository root)
infrastructure/nginx    TLS, static SPA, reverse proxy
```

**Stack:** TypeScript (strict, `any` is an ESLint error) · PostgreSQL + Prisma · Redis ·
OpenAI · PM2. No containers anywhere — Postgres and Redis are external services reached by
connection string.

Full reasoning in [`docs/architecture.md`](docs/architecture.md).

## Getting started

**Requires** Node ≥ 20.11, pnpm 12, a PostgreSQL ≥ 14 instance, and (optionally) Redis.

```bash
pnpm install
cp .env.example .env          # set DATABASE_URL and OPENAI_API_KEY
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev                      # API on :50005, web on :50004
```

Mobile:

```bash
cd apps/mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:50005/api/v1
```

### Running without every dependency

The repo is built so a missing piece degrades rather than breaks:

| Missing    | Set                          | Effect                                                          |
| ---------- | ---------------------------- | --------------------------------------------------------------- |
| Redis      | `REDIS_ENABLED=false`        | No-op cache, in-process rate limiting, `inline` execution       |
| OpenAI key | leave `OPENAI_API_KEY` empty | Agents use their declared fallbacks; the app stays usable       |
| PostgreSQL | —                            | Required. Learning state must be durable; there is no fallback. |

## Environment

Every variable is parsed and validated once at boot by `@forgeroutine/config`. A
misconfigured deployment fails immediately with a readable message. See
[`.env.example`](.env.example) for the full contract; the ones that matter:

```
DATABASE_URL          PostgreSQL connection string (source of truth)
DIRECT_DATABASE_URL   Direct endpoint for migrations, when DATABASE_URL is a pooler
REDIS_URL             Cache, queues, rate limiting
REDIS_ENABLED         false disables all three cleanly
OPENAI_API_KEY        Empty disables AI; agents fall back
JWT_ACCESS_SECRET     ≥ 32 chars, must differ from the refresh secret
JWT_REFRESH_SECRET
EXECUTION_DRIVER      inline | queue — must be `queue` in production
```

Secrets never go in source control.

## Commands

|                                             |                                       |
| ------------------------------------------- | ------------------------------------- |
| `pnpm dev`                                  | Everything in watch mode              |
| `pnpm build`                                | Topological build                     |
| `pnpm typecheck`                            | `tsc --noEmit` everywhere             |
| `pnpm lint`                                 | ESLint everywhere                     |
| `pnpm test`                                 | Vitest (packages, web) and Jest (api) |
| `pnpm db:migrate` / `db:seed` / `db:studio` | Prisma                                |

Filter with `pnpm --filter @forgeroutine/api <cmd>`.

## Testing

| Layer              | Runner         | Covers                                                          |
| ------------------ | -------------- | --------------------------------------------------------------- |
| `packages/*`       | Vitest         | Scoring, graph traversal, scheduling, AI contracts              |
| `packages/sandbox` | Vitest         | Real child processes: timeout kills, env stripping, output caps |
| `apps/api`         | Jest           | Use-cases against fake ports; the assistance-ladder projection  |
| `apps/web`         | Vitest         | Components and hooks                                            |
| `apps/mobile`      | `flutter test` | Unit and widget tests                                           |

Three AI-specific suites run offline against a deterministic fake provider: **contract**
(every agent's output parses against its schema), **consistency** (repeat evaluations stay
within tolerance), and **prompt regression** (adversarial "just give me the code" messages
do not yield code below `SHOW_SOLUTION`).

## Deployment

PM2, no containers. See [`docs/deployment.md`](docs/deployment.md).

```bash
pnpm install --frozen-lockfile
pnpm db:generate && pnpm build
pnpm --filter @forgeroutine/database exec prisma migrate deploy
pnpm start                    # PM2, all three processes
pm2 save
```

`forgeroutine-api` runs in cluster mode (reload is zero-downtime);
`forgeroutine-sandbox` runs in fork mode because it spawns child processes of its own.

## Known limitations

Tracked openly rather than hidden — see [`docs/roadmap.md`](docs/roadmap.md).

1. **The sandbox is not a security boundary.** It stops accidents and casual escapes, not a
   determined attacker. There is no network isolation, and on Windows no filesystem
   isolation either (Node's permission model aborts on drive-letter paths). Acceptable while
   single-tenant; the port exists so a container backend can replace it.
2. **Copy/paste detection is advisory**, client-reported, and never affects scores.
3. **Curriculum quality varies** between curated and AI-generated technologies.
4. **Retention modelling is SM-2-derived**, not yet calibrated against real data.

## Documentation

|                                                                             |                                              |
| --------------------------------------------------------------------------- | -------------------------------------------- |
| [product.md](docs/product.md)                                               | What this is for and what it refuses to be   |
| [architecture.md](docs/architecture.md)                                     | Layering, module shape, request lifecycle    |
| [knowledge-graph.md](docs/knowledge-graph.md)                               | Prerequisites, weakness tracing, readiness   |
| [coding-muscle.md](docs/coding-muscle.md)                                   | The assistance ladder and the headline score |
| [ai-architecture.md](docs/ai-architecture.md)                               | Provider port, agents, degradation           |
| [ai-assistance-policy.md](docs/ai-assistance-policy.md)                     | Binding rules for every AI feature           |
| [curriculum-engine.md](docs/curriculum-engine.md)                           | Generation, versioning, the user's universe  |
| [code-execution.md](docs/code-execution.md)                                 | Sandbox design and an honest threat model    |
| [interview-engine.md](docs/interview-engine.md)                             | Adaptive follow-ups and scoring              |
| [database.md](docs/database.md) · [api.md](docs/api.md)                     | Data model and HTTP contract                 |
| [development.md](docs/development.md) · [deployment.md](docs/deployment.md) | Working on it, shipping it                   |
| [roadmap.md](docs/roadmap.md)                                               | Phases, and what is deferred on purpose      |
