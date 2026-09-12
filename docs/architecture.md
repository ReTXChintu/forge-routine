# Architecture

## Shape

ForgeRoutine is a **modular monolith** (§45.15–16), not microservices. One deployable API
process, internally split by business domain. The one thing that is *not* in that process is
user code execution — that is physically isolated (§45.8).

```
┌─────────────┐      ┌─────────────┐      ┌──────────────────┐
│  apps/web   │      │ apps/mobile │      │  future clients  │
│ React+Vite  │      │   Flutter   │      │                  │
└──────┬──────┘      └──────┬──────┘      └────────┬─────────┘
       │                    │                      │
       └──────────── REST /api/v1 ─────────────────┘
                            │
                  ┌─────────▼──────────┐
                  │      apps/api      │   NestJS modular hexagonal
                  │  ┌──────────────┐  │
                  │  │ domain mods  │  │   auth users learning curriculum
                  │  │              │  │   skills routines sessions
                  │  │              │  │   exercises submissions ai ...
                  │  └──────────────┘  │
                  └──┬──────┬───────┬──┘
                     │      │       │
         ┌───────────▼┐  ┌──▼────┐  └──────────────┐
         │ PostgreSQL │  │ Redis │                 │
         │  (truth)   │  │cache/ │        ┌────────▼─────────┐
         │   Prisma   │  │queue  │        │  apps/sandbox    │
         └────────────┘  └───────┘        │ isolated runner  │
                                          │  child process   │
                                          └──────────────────┘
                            │
                  ┌─────────▼──────────┐
                  │  packages/ai       │  provider-independent interface
                  │  └─ openai         │  (OpenAI is the configured provider)
                  └────────────────────┘
```

## Layering inside a domain module

Each module under `apps/api/src/modules/<domain>/` follows the same hexagonal shape:

```
<domain>/
├── domain/            pure business types, entities, value objects, policies
│                      NO framework imports, NO Prisma, NO HTTP
├── application/       use-cases / services. Orchestrates domain + ports.
│   └── ports/         interfaces the domain needs (repositories, clocks, AI)
├── infrastructure/    adapters that implement ports (Prisma repos, Redis, AI)
├── http/              controllers + DTOs. Transport only.
└── <domain>.module.ts NestJS wiring: binds ports to adapters
```

Rules enforced by review and by `.eslintrc.json`:

- **No business logic in controllers** (§45.3). A controller validates a DTO, calls one
  use-case, maps the result. If a controller has an `if` about business meaning, it is wrong.
- **No Prisma types leaking upward.** `domain/` never imports `@prisma/client`. Repositories
  return domain objects.
- **Ports are owned by the application layer**, implemented by infrastructure. Dependencies
  point inward.

## Why hexagonal here specifically

Two parts of this product are near-certain to be replaced:

1. The execution backend (inline child process → queued workers → containers/microVMs).
2. The AI provider and the prompts behind it.

Both sit behind ports. Swapping them must not touch the learning domain. That is the whole
reason for the ceremony; we do not apply it to modules that will never change shape.

## Packages

| Package | Responsibility | May depend on |
| --- | --- | --- |
| `shared-types` | Domain types + enums shared by API, web, and tooling. Zero runtime deps. | — |
| `validation` | Zod schemas. Single source of truth for every external boundary. | shared-types |
| `config` | Parses and validates `process.env` once, exports typed config. | validation |
| `utils` | Pure helpers (result type, ids, time, scoring math). | shared-types |
| `database` | Prisma schema, client singleton, seeds. | config |
| `ai` | Provider interface, OpenAI adapter, agents, structured-output contracts. | config, validation, shared-types |
| `curriculum` | Curriculum generation logic, knowledge-graph algorithms, seed data. | shared-types, validation, ai |

Dependency direction is strictly one-way; there are no cycles. `shared-types` is the root.

## Request lifecycle (coding submission)

```
POST /api/v1/submissions
  → SubmissionsController         validate DTO (zod pipe)
  → SubmitSolutionUseCase         application layer
      ├─ ExerciseRepository       load exercise + tests            (Prisma)
      ├─ CodeExecutionPort        run tests in isolated process    (sandbox)
      ├─ EvaluatorAgent           structured AI evaluation         (packages/ai)
      ├─ SkillUpdateService       write 9 skill dimensions         (Prisma)
      ├─ IndependenceService      recompute Independent Coding Score
      └─ ReviewScheduler          schedule spaced repetition
  → SubmissionResultDto
```

Note the ordering: **execution happens before AI evaluation**, and the AI receives real test
results as ground truth. We never ask a model whether code passes — we measure it, then ask
the model about quality. This keeps business logic off arbitrary AI prose (§45.7, §28).

## Data flow principles

- PostgreSQL is the source of truth for **all** learning state (§29).
- Redis holds only derivable or ephemeral state: caches, queues, rate-limit counters,
  in-flight session scratch. Losing Redis must never lose learning history.
- AI output is validated against a Zod schema before it touches the domain. Invalid output is
  retried, then degraded gracefully — never persisted raw.

## Deployment

PM2, no containers. See `deployment.md`.
