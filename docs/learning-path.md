# The Learning Path

How a new user goes from an empty account to a personalised, ordered journey — and how
that journey stays a journey rather than a pile of exercises.

This document covers onboarding, roadmap generation, projects, recall prompts, and the
interview guide. It is the design the §39 phase plan is now built around.

## The problem with what exists today

The knowledge graph answers _"what depends on what"_. It does not answer the question a
user actually has on day one:

> I picked six technologies. What do I do first, and what after that?

`nextAction` answers only the immediate step, by rule, one item at a time. There is no
visible path, no sense of progress against a whole, and nothing that says "you are in
week three of nine". A user who cannot see the path cannot trust it.

Worse: adding a technology with no curated curriculum currently produces an empty shell.
The product promises "add any technology" (§25) and delivers concepts for JavaScript and
Node.js only.

## Shape of the solution

```
  ONBOARD              GENERATE                    LEARN
  ─────────            ─────────                   ─────────
  pick technologies →  skeleton  (seconds)      →  roadmap visible, phase 1 startable
  goals, time,         ↓
  target level         content   (background)   →  phases 2..n fill in behind you
                       per technology,
                       priority order
```

The user is never blocked on the slow part. That is the central constraint.

## Onboarding

First login only. Four questions, in this order, because each narrows the next:

1. **What do you want to get better at?** — technology multi-select from the catalogue,
   plus free text for anything not in it (§41: technologies are data).
2. **Where are you now, per technology?** — a coarse self-rating. Seeds initial skill
   estimates so an expert is not shown "Variables" (§5). Deliberately coarse: precise
   self-assessment is exactly the thing this product distrusts.
3. **How much time per day?** — 30 / 45 / 60 / 90 / 120 (§21).
4. **What is this for?** — coding ability, an interview, a job hunt, general mastery. Plus
   an optional interview date, which changes everything downstream.

Skippable with defaults. A user who abandons onboarding still gets a usable product;
they just get a generic path.

## Generation, in two stages

Generating full curricula for six technologies is many model calls and minutes of
wall-clock. Doing that behind a spinner is the wrong trade twice over: the user waits, and
we pay for content they may never reach.

### Stage A — skeleton (seconds, one call)

Produces the shape of the journey, not its contents:

- which technologies, in which order, and why
- phase boundaries with a goal per phase
- a concept outline per technology (names and one-liners, no detail)
- where projects and interview checkpoints fall

Written to the database in one transaction. The user sees their whole path immediately and
can start phase 1 as soon as its content lands.

### Stage B — content (background, priority order)

Per technology, in the order the roadmap will reach them:

```
outline → concept detail → prerequisite edges → exercises → interview questions
```

Each technology commits atomically as a `CurriculumVersion` (see `curriculum-engine.md`).
Technology _n+1_ generates while the user works through _n_.

### "Come back later"

Only shown when the user reaches content that is not ready yet — not as a blanket gate.
In practice that means the first technology only, and only if they are fast.

The job state lives in **PostgreSQL**, not Redis, so a restart mid-generation does not
lose the user's place (§29). Redis carries the work to the worker; Postgres remembers
what was asked for and how far it got.

```
GenerationJob(userId, kind, target, status, progress, attempts, error, startedAt, finishedAt)
  status: QUEUED | RUNNING | PARTIAL | READY | FAILED
```

`PARTIAL` matters: with four of six technologies generated, the product is usable. Showing
"not ready" would be a lie.

## The roadmap

**A roadmap is a traversal of the knowledge graph, not a copy of it.**

This is the rule that keeps the model honest. `RoadmapItem` references `conceptId` and
`exerciseId`; it never duplicates their content. Skill history is keyed on concept ids, so
copying concepts into a per-user roadmap would orphan every skill record the moment the
roadmap regenerates.

```
Roadmap(userId, version, status, generatedBy, generatedAt)
  └─ RoadmapPhase(orderIndex, title, goal, estimatedHours)
       └─ RoadmapItem(orderIndex, kind, conceptId?, exerciseId?, status, rationale)
            kind: LEARN | RECALL | CODE | DEBUG | PROJECT | CHECKPOINT | INTERVIEW
```

### Roadmap vs. daily routine

Different time horizons, and conflating them would produce a planner that fights itself:

|           | Roadmap                                        | Routine             |
| --------- | ---------------------------------------------- | ------------------- |
| Span      | The whole journey, weeks                       | Today, 45 minutes   |
| Stability | Regenerated rarely, on request or major change | Regenerated daily   |
| Answers   | "Where am I going?"                            | "What do I do now?" |

The routine is a **slice of the roadmap**, adjusted for what is due for review and where
the user is currently weak. The roadmap supplies the backlog; the routine picks from it.
This replaces the standalone planner originally imagined for Phase 5 — a routine
generated independently of a roadmap would quietly diverge from it.

### Regeneration

The roadmap is versioned and regenerated when the user adds or removes a technology,
changes their goal or interview date, or asks. Completed items keep their status across a
regeneration by concept id. Progress is never lost to a replan.

## Projects

Every phase ends in a project, which in practice is every 5–6 lessons.

A project differs from an exercise in three ways that matter:

1. **It spans the phase**, not one concept. The point is composition — the thing that is
   never exercised by isolated drills.
2. **It has progressive requirements** (§14): API, then auth, then validation, then error
   handling. Each step is submittable.
3. **It is reviewed, not just tested.** The reviewer agent acts as tech lead (§14, §31):
   it finds issues and explains them, and does not rewrite the user's code.

Projects feed `problemSolving` and `architecture`, which isolated exercises barely touch.

A project is a checkpoint in the honest sense: failing it sends the user back into the
phase with a specific list, rather than waving them through.

## Recall prompts

Short conceptual questions, surfaced between activities.

**The hard rule: never during coding.** An interruption mid-problem destroys the exact
state this product exists to build, and trains the user to dismiss prompts without
reading. Prompts appear at boundaries only:

- session start
- after a submission resolves
- between routine items
- explicitly, from the command palette

Each is answerable in 10–20 seconds. Selection comes from the existing `ReviewSchedule`
(SM-2 derived) so they are not random in the damaging sense — they are _due_. They feed
`recallStrength` and `retention`, two dimensions currently starved of evidence because
nothing else measures them.

Wrong answers do not punish. They schedule.

## The interview guide

Distinct from the interview _engine_, and worth building first because it is cheap and
immediately useful.

|         | Guide                                    | Engine (§15–17)                    |
| ------- | ---------------------------------------- | ---------------------------------- |
| What    | A readiness dossier                      | A live adaptive mock               |
| Answers | "Where do I stand, and what is missing?" | "How do I perform under pressure?" |
| Cost    | One generation per technology            | Many calls per session             |

The guide is per technology, and per target level (junior / mid / senior):

- what interviews actually ask in this area, grouped by theme
- the user's readiness per theme, from the skill model
- the gap list — specific, ordered, each linked to a concept or exercise
- worked answers, revealed only after the user has attempted their own

It is generated once and refreshed as the skill model moves. The engine rehearses; the
guide tells you what to rehearse.

## Cost

Generation is by far the most expensive thing in this product, and the only part where a
single click can spend real money.

- Estimate before starting, and show it.
- `AI_DAILY_TOKEN_BUDGET` already caps per-user daily spend; generation respects it and
  degrades to `PARTIAL` rather than failing.
- Never regenerate what has not changed. Curriculum is versioned and cached per
  technology, shared across users — the second user to pick Docker pays nothing.
- Stage B is priority-ordered specifically so that abandoning after one technology costs
  one technology.
