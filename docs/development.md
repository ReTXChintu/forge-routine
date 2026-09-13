# Development

## Prerequisites

| Tool       | Version  | Notes                                           |
| ---------- | -------- | ----------------------------------------------- |
| Node.js    | >= 20.11 |                                                 |
| pnpm       | 12.x     | `corepack enable`                               |
| PostgreSQL | >= 14    | External instance; connection string only       |
| Redis      | >= 6     | Optional in development (`REDIS_ENABLED=false`) |
| Flutter    | >= 3.27  | Mobile only                                     |

No Docker. PostgreSQL and Redis are reached by URL, local or remote.

## First run

```bash
pnpm install
cp .env.example .env          # then fill DATABASE_URL and OPENAI_API_KEY
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm dev` runs the API on `:50005` and the web app on `:50004` through Turborepo, along with
a watcher for every shared package so a change in `packages/*` propagates without a manual
rebuild.

It deliberately **excludes** `@forgeroutine/sandbox-worker`: that process requires Redis and
exits immediately without it, so including it would break the default dev run for anyone
using `EXECUTION_DRIVER=inline`. Start it separately when you are working on queued
execution:

```bash
pnpm dev:worker     # sandbox worker only; needs REDIS_ENABLED=true
pnpm dev:apps       # web + API only, no package watchers
```

Turbo needs `concurrency` in `turbo.json` to exceed the number of persistent tasks. Adding a
package with a `dev` script means raising it.

## Running without infrastructure

The repo is designed so that a missing dependency degrades rather than breaks:

| Missing    | Set                          | Effect                                                          |
| ---------- | ---------------------------- | --------------------------------------------------------------- |
| Redis      | `REDIS_ENABLED=false`        | No-op cache, in-memory rate limiting, `inline` execution driver |
| OpenAI key | leave `OPENAI_API_KEY` empty | AI agents return their declared fallbacks; the app stays usable |
| PostgreSQL | —                            | Required. There is no fallback; learning state must be durable. |

## Layout

```
apps/web        React + Vite + Chakra + Monaco. The primary coding environment.
apps/api        NestJS modular hexagonal API.
apps/sandbox    Code execution workers (PM2 fork mode).
apps/mobile     Flutter. Routine, review, interview, progress.
packages/*      Shared libraries. See architecture.md for the dependency rules.
infrastructure/ PM2 ecosystem and nginx config.
scripts/        Repo tooling.
```

## Commands

| Command           | Effect                                     |
| ----------------- | ------------------------------------------ |
| `pnpm dev`        | Everything in watch mode                   |
| `pnpm build`      | Topological build of all packages and apps |
| `pnpm typecheck`  | `tsc --noEmit` everywhere                  |
| `pnpm lint`       | ESLint everywhere                          |
| `pnpm test`       | Vitest (packages, web) and Jest (api)      |
| `pnpm format`     | Prettier write                             |
| `pnpm db:migrate` | Create and apply a dev migration           |
| `pnpm db:seed`    | Seed technologies, concepts, exercises     |
| `pnpm db:studio`  | Prisma Studio                              |

Filter to one workspace with `pnpm --filter @forgeroutine/api <cmd>`.

## Conventions

- TypeScript strict everywhere. `any` is an ESLint error, not a warning (§45.1–2).
- Conventional Commits: `feat(scope):`, `fix(scope):`, `docs:`, `refactor:`, `test:`,
  `chore:`. The scope is the package or module (`feat(coding-muscle): ...`).
- Husky runs lint-staged pre-commit and `typecheck` pre-push.
- Branches: `feat/<short-slug>`, `fix/<short-slug>`.

## Adding a domain module to the API

1. `apps/api/src/modules/<domain>/` with `domain/`, `application/`, `infrastructure/`,
   `http/`.
2. Define ports in `application/ports/`. Implement them in `infrastructure/`.
3. Wire them in `<domain>.module.ts`. Register the module in `app.module.ts`.
4. Controllers may call exactly one use-case and map its result. No logic.
5. Add unit tests for the use-case against fake ports, plus one integration test.

## Testing (§32)

| Layer                  | Runner                   | What it covers                                                 |
| ---------------------- | ------------------------ | -------------------------------------------------------------- |
| `packages/*`           | Vitest                   | Pure logic: scoring, graph traversal, scheduling, AI contracts |
| `apps/api` unit        | Jest                     | Use-cases against in-memory fake ports                         |
| `apps/api` integration | Jest + Supertest         | HTTP through to a real test database                           |
| `apps/web`             | Vitest + Testing Library | Components and hooks                                           |
| `apps/mobile`          | `flutter test`           | Unit and widget tests                                          |

AI-specific suites, all offline against the deterministic fake provider:

- **Contract tests** — every agent's output parses against its Zod schema.
- **Evaluation consistency** — the same submission evaluated repeatedly stays within a
  tolerance band.
- **Prompt regression** — adversarial "just give me the answer" messages do not yield code
  below `SHOW_SOLUTION`.

Business-critical logic (scoring, scheduling, the assistance ladder, execution isolation)
requires tests. UI glue does not.

## Windows notes

Development is supported on Windows. Two things to know:

- The sandbox's POSIX-only isolation (process-group kill semantics, uid dropping) degrades on
  Windows; execution still runs out-of-process with timeout and memory caps.
- `.gitattributes` and `core.autocrlf=false` keep LF endings; the sandbox harness is
  line-ending sensitive.
- `pnpm build` can fail with `EPERM: operation not permitted, rename
...query_engine-windows.dll.node`. This is not a code problem: `prisma generate` rewrites
  that DLL, and Windows refuses while any node process still has the Prisma client loaded —
  typically a dev server or a test run that has not fully exited. Kill the stragglers and
  rebuild:

  ```powershell
  Get-Process node,esbuild -ErrorAction SilentlyContinue | Stop-Process -Force
  ```
