# Roadmap

Phases are ordered by dependency, not by appeal. Phase 3 is the product; Phases 1–2 exist to
make it possible.

## Phase 1 — Foundation

Monorepo, web shell, API skeleton, Flutter shell, PostgreSQL + Prisma, Redis client,
authentication, design system, environment configuration, PM2 development and deployment
setup.

Done when: `pnpm dev` runs web + API, a user can register and log in, and CI is green.

## Phase 2 — Learning Engine

Technology catalogue and user universe, concepts, prerequisite graph, curriculum storage and
versioning, the nine-dimension skill model, progress tracking.

Done when: a user can add a technology, browse its concepts, and see skills recorded.

## Phase 3 — Coding Muscle (highest priority)

Coding exercises, Monaco editor, attempts and submissions, out-of-process code execution,
the assistance ladder, progressive assistance levels 1–5, Blind Coding, debugging exercises,
the Independent Coding Score.

Done when the §48 vertical slice runs end to end and the MVP question can be answered:

> Can ForgeRoutine make me better at writing code without AI?

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

1. **Sandbox network isolation is a harness stub**, not a kernel control. See
   `code-execution.md`.
2. **Copy/paste detection is advisory** and client-reported; it never affects scores.
3. **Curriculum quality varies** between curated and AI-generated technologies.
4. **Retention modelling is SM-2-derived**, not empirically calibrated to this user.
