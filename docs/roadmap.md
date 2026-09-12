# Roadmap

Phases are ordered by dependency, not by appeal. Phase 3 is the product; Phases 1–2 exist to
make it possible.

## Phase 1 — Foundation — **done**

Monorepo, web shell, API skeleton, Flutter shell, PostgreSQL + Prisma, Redis client,
authentication, design system, environment configuration, PM2 development and deployment
setup.

Verified: migration applied to a live PostgreSQL instance, seed loaded, API boots and
answers over HTTP, web bundle builds and serves, Flutter analyzes and tests clean.

## Phase 2 — Learning Engine — **done**

Technology catalogue and user universe, concepts, prerequisite graph, curriculum storage and
versioning, the nine-dimension skill model, progress tracking.

Verified end to end: a user adds a technology, its curriculum imports, concepts list in
dependency order, and skill changes land in both the projection and the event ledger.

## Phase 3 — Coding Muscle (highest priority) — **done**

Coding exercises, Monaco editor, attempts and submissions, out-of-process code execution,
the assistance ladder, progressive assistance levels 1–5, Blind Coding, debugging exercises,
the Independent Coding Score.

The §48 vertical slice runs green against a live database: 19 steps from registration to a
persisted skill change, including the debugging diagnose-then-fix flow.

Shipped: 17 exercises across 9 concepts, every one proven solvable by executing its
reference solution in the real sandbox. Three debugging exercises whose broken code is
proven to fail and whose fixes are proven to pass.

Still thin here, and deliberately so: exercises exist only for JavaScript and Node.js,
because those are the languages the MVP sandbox can execute. See "Deferred" below.

## Phase 4 — AI Tutor

Socratic tutor, concept explanations, the hint engine, code review, mistake analysis,
personalised recommendations.

## Phase 5 — Routine Engine

Daily routine generation, adaptive scheduling, spaced repetition, weak-skill prioritisation,
available-time optimisation.

## Phase 6 — Interview Engine

Technical and coding interviews, adaptive follow-ups, ten-dimension scoring, interview
reports, interview readiness.

## Phase 7 — Advanced Engineering

System design, the production incident simulator, DevOps challenges, Linux terminal
simulation, architecture challenges.

## Phase 8 — Mobile

Flutter expansion: daily routine, reviews, interviews, voice interview, progress,
notifications.

## Deferred deliberately

| Item                         | Why                                                    | Revisit when            |
| ---------------------------- | ------------------------------------------------------ | ----------------------- |
| Container/microVM sandbox    | Single-tenant today; the port already exists           | A second untrusted user |
| Python / Rust / Go execution | Needs real toolchain isolation                         | Sandbox hardening lands |
| Real-time collaboration      | No user need identified                                | —                       |
| Prometheus / Grafana         | Structured logs suffice at this scale                  | Multi-node deployment   |
| OAuth providers              | Email+password is enough for one user; the seam exists | Real multi-user         |
| GraphQL                      | REST is sufficient and simpler                         | Client shapes diverge   |

## Known gaps carried forward

Tracked honestly rather than hidden:

1. **Sandbox isolation is partial.** There is no network isolation at all, and on Windows
   no filesystem isolation either — Node 20's permission model aborts on drive-letter
   paths, so the runner detects this at boot and drops the flags with a warning. See
   `code-execution.md` for the full, honest table.
2. **Copy/paste detection is advisory** and client-reported; it never affects scores.
3. **Curriculum quality varies** between curated and AI-generated technologies.
4. **Retention modelling is SM-2-derived**, not empirically calibrated to this user.
