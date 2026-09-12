# Roadmap

Phases are ordered by dependency, not by appeal.

Phases 1–3 are complete: a user can write code, run it, and have the system remember what
they actually know. What is missing is the _path_ — an answer to "I picked six
technologies, what do I do first?" Phase 4 onwards builds that, and the design is in
`learning-path.md`.

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

## Phase 4 — Onboarding and the Generated Roadmap — **done**

The largest remaining gap between what the product promises and what it does. Today,
adding a technology with no curated curriculum logs "awaiting generation" and produces an
empty shell: §25 promises any technology, and only JavaScript and Node.js exist.

Design in `learning-path.md`.

- First-run onboarding: technologies, existing knowledge, daily time, goal, interview date
- The curriculum generator agents — contracts already exist, implementation does not
- Two-stage generation: a skeleton in seconds, content in the background by priority
- `GenerationJob` state in PostgreSQL, so a restart mid-generation loses nothing
- `PARTIAL` readiness, because four of six technologies is usable and saying otherwise
  would be a lie
- The roadmap itself: phases, ordered items, visible rationale
- Roadmap UI, and a "come back shortly" state reached only by outrunning generation

Verified against the live database and real OpenAI: onboarding returns a roadmap
instantly while curriculum generates behind the user, and the roadmap replans itself when
content lands. Docker, React, TypeScript and Linux generated.

Two limits found by running it, both recorded in `code-execution.md`:

- Only JavaScript, TypeScript and Node.js can have _runnable_ exercises. React and
  Next.js need a JSX transform and a React runtime the sandbox does not have; everything
  else cannot be graded by executing JavaScript at all. Those technologies get concept
  questions, which is honest practice rather than exercises that cannot run.
- Generated content is proven _solvable_, not proven _well-chosen_. The verifier executes
  every exercise before it ships; nobody reviews whether it was worth setting.

## Phase 5 — Projects and Checkpoints — **next**

Every phase of a roadmap ends in a project — in practice every 5–6 lessons.

- The `PROJECT` exercise kind (reserved in the enum, unimplemented)
- Progressive requirements (§14): API, auth, validation, error handling, each submittable
- Tech-lead review by the reviewer agent: finds issues, explains them, does not rewrite
- Checkpoint semantics — a failed project returns the user to the phase with a specific
  list rather than waving them through

Projects are the only thing that exercises composition. Isolated drills never do, which
is why `problemSolving` and `architecture` are currently starved of evidence.

## Phase 6 — Recall Prompts and the Question Bank

Short conceptual questions between activities, never during coding.

Partly built already: Phase 4 generates the questions, and 160 of them are in the
database. What is missing is delivery — nothing surfaces them yet.

- ~~Question bank generated per concept~~ — done in Phase 4
- Delivery at boundaries only: session start, after a submission, between routine items
- Selection from the existing `ReviewSchedule`, so prompts are _due_ rather than random
- Feeds `recallStrength` and `retention`, two of the nine dimensions that nothing
  currently measures
- Wrong answers schedule, they do not punish

## Phase 7 — Daily Routine

Now a slice of the roadmap rather than an independent planner.

- Today's items drawn from the roadmap backlog
- Adjusted for what is due for review and where the user is currently weak
- Fitted to available time (§21)
- Weak-skill prioritisation via the knowledge graph's root-cause trace

Deliberately after the roadmap: a routine generated independently of a path would quietly
diverge from it, and two planners disagreeing is worse than one.

## Phase 8 — Interview Guide and Engine

The guide first, because it is cheap and useful immediately; the engine after.

**Guide** — a readiness dossier per technology and target level: what gets asked, where
the user stands per theme, and an ordered gap list linked to concepts and exercises.

**Engine** (§15–17) — live adaptive interviews, the follow-up engine, ten-dimension
scoring, interview reports.

The guide tells you what to rehearse. The engine is the rehearsal.

## Phase 9 — Advanced Engineering

System design, the production incident simulator, DevOps challenges, Linux terminal
simulation, architecture challenges.

## Phase 10 — Mobile

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
