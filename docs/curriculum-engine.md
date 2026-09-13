# Curriculum Engine

## Principle

The curriculum is **data, not code** (§25, §41, §45.13). No technology name appears in a
`switch` statement, a React component, or a database enum. Adding Rust must require zero
frontend changes.

## The user's learning universe

A user composes their own universe from the `Technology` catalogue and can change it at any
time (§5):

| Action               | Effect                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Add                  | Creates `UserTechnology`; triggers curriculum generation if the technology has no concept graph yet    |
| Remove               | **Soft delete.** `status = ARCHIVED`, `archivedAt` set. All skills, attempts, and history are retained |
| Pause                | `status = PAUSED`. Excluded from routine generation; review schedule frozen                            |
| Resume               | `status = ACTIVE`. Review schedule resumes with elapsed time accounted for                             |
| Priority             | `LOW                                                                                                   | NORMAL   | HIGH       | CRITICAL` — weights routine time allocation |
| Target proficiency   | `AWARENESS                                                                                             | WORKING  | PROFICIENT | EXPERT` — sets the mastery goal             |
| Existing knowledge   | Seeds initial skill estimates so an expert is not shown "Variables"                                    |
| Interview importance | `0-5`. Multiplies interview-readiness weighting                                                        |
| Frequency            | `DAILY                                                                                                 | FREQUENT | OCCASIONAL | RARE` — caps how often it appears           |

Removing a technology must never destroy learning history. Re-adding it restores the user's
prior skill state, decayed by elapsed time rather than reset.

## What gets generated, and when

Generation is the only part of this product that costs money per use, so the
question is not just _what_ to build but _when_ to pay for it.

**One technology at a time, in a hand-authored order, on demand.**

The order lives in the catalogue as `dependsOn` (what is forbidden) plus
`learningOrder` (what is wanted). Both are data. Nobody needs a model to work
out that React comes after JavaScript, and the generator's own
cross-technology prerequisites cannot help here anyway: they only exist once
both sides have been built, which is too late to decide what to build first.

The trigger is progress, not sign-up. The first technology is built during
onboarding; each subsequent one is queued when the user is
`GENERATE_AHEAD_AT` (60%) of the way through what they already have. The lead
time is deliberate — generation takes minutes, so waiting until they are
actually blocked means they sit and wait.

`pnpm db:generation-plan` shows the order, the progress, and what would be
built next, without calling OpenAI.

### Why this changed

The first version queued every technology the user selected, during
onboarding. A real sign-up selected seventeen and the queue built eight
before anyone noticed — for a user who had not yet completed a single
exercise. Seven of the eight were technologies they were months away from
reaching, and some they might never open.

Two separate bugs made it worse than the design intended:

- `drain` looped until the queue was empty, so a backlog from any source —
  an older version, a crash, a double submit — would run end to end. It now
  takes exactly one job per call.
- Nothing ever wrote to `AIInteraction`. The table and its schema comment
  had been there since the first migration, but no code populated it, so the
  only record of spend was the OpenAI dashboard, which cannot say which
  technology or which agent caused it. A `RecordingAIProvider` decorator now
  wraps the real provider and records every call: agent, model, tokens,
  latency, outcome. It is a decorator rather than a change inside the AI
  package so that package keeps no database dependency.

Prompts are hashed rather than stored. They contain the user's own code and
their interview answers, and an observability table should not quietly become
a transcript of everything they have written.

### A seeded curriculum is not a course

`javascript` and `nodejs` ship with hand-written concepts, and those are
drills for an engineer filling gaps — the JavaScript set opened at closures,
with no variables and no control flow. Counting them as built is why asking
to start with JavaScript produced a course beginning in the middle.

A technology counts as finished only when the _current_ generator has
produced a curriculum for it. A `seed-1` version means a starter set and the
technology still enters the pipeline.

Generation then **extends rather than replaces**: existing concepts are
passed to the outline agent, which is told to include every one of them
reusing its slug exactly and to fill in whatever is missing around them. The
first real run of this produced a ten-concept course opening at Variables
and Data Types and closing at Async Error Handling, with all seven curated
concepts absorbed and **nothing archived** — so the hand-written exercises
survived. A dropped slug is logged as a warning, because orphaning verified
exercises should never be silent.

### Strict order

A learner cannot skip ahead. The next concept opens when the one before it
is cleared, where cleared means one passed attempt — a historical fact, not
a mastery score. Mastery decays and is estimated from several signals, so
gating on it would re-lock material the user has genuinely finished.

This sits alongside the knowledge graph rather than replacing it. The graph
asks "do you know enough to attempt this", which leaves most concepts open
from day one; the sequence asks "have you finished the one before it". Both
must be open. A concept with no exercises and no questions can never be
cleared, so it never blocks — otherwise a generation that produced a
reading-only concept would wall the user in permanently.

### Sharing

Curriculum is per-technology, not per-user: a `Concept` belongs to a
`Technology`. The second person to pick Docker pays nothing, because the
check is on concept count and content already exists. This was already true
and is now relied on deliberately rather than by accident.

## Generation pipeline

Triggered when a technology has no curriculum version for the current generator version.

```
1. RESOLVE    Is there an existing curated curriculum? Use it. Stop.
2. PLAN       outlineAgent produces a concept outline (names + one-line descriptions)
3. EXPAND     For each concept, generate the full concept record
4. LINK       Propose prerequisite edges, including into the user's existing technologies
5. PRACTISE   Exercises where the sandbox can run them, concept questions where it cannot
6. PROJECT    One project per roadmap phase, composing that phase's concepts
7. VALIDATE   Zod schema + DAG cycle check + sandbox verification of everything runnable
8. PERSIST    Write atomically as CurriculumVersion N; nothing partial is ever visible
```

Steps 2–4 are separate model calls. One call asked to produce an entire technology curriculum
returns shallow, uniform output; splitting plan from expansion produces materially better
depth per concept and lets step 3 run in parallel.

### Projects (step 6)

Concepts are grouped exactly as the roadmap groups phases — `DEFAULT_CONCEPTS_PER_PHASE`
is imported from the roadmap builder rather than repeated, because the roadmap closes
each phase by looking for a `PROJECT` exercise among that phase's concepts. If the two
groupings disagreed, the project would land in a phase that never looks for it and
silently degrade into a checkpoint.

A project is stored as an `Exercise` of kind `PROJECT` with ordered `ProjectStep`
children. Reusing `Exercise` means attempts, submissions, skill evidence and the roadmap
all work on projects with no second code path — and a second code path is where the
assistance ladder would eventually be forgotten. Test cases hang off the step rather than
the exercise, so the runner can select "this step and every earlier one" with one filter.

**Verification runs the project the way it will be graded.** Each step's reference
solution executes against its own tests _and every earlier step's_. A project is rejected
whole if any step fails: a partially valid project cannot be trimmed to its working
prefix, because the steps that remain were written to lead somewhere it no longer goes.

This is not theoretical. The first live run generated two projects and rejected one —
step 2's solution broke a step 1 test, making the project unwinnable. Without the
cross-step check it would have shipped, and the user would have spent the evening hunting
for a fault in their own code that was actually in ours.

Projects are generated only where exercises survived verification. A technology practised
through concept questions has no runnable drills, and a project is the one thing that
absolutely must execute, because it is graded entirely by its tests.

## Concept record

Every concept carries (§26):

```
id, slug, name, description, difficulty (1-5),
prerequisites[], learningObjectives[],
codingPatterns[], commonMistakes[],
interviewQuestions[], codingExercises[], debuggingExercises[]
```

`commonMistakes` is not decoration — the debugging-exercise generator uses it as its source
of realistic faults, and the evaluator uses it to recognise a known failure mode in user code.

## Versioning (§26)

AI-generated curriculum is **stored and versioned**, never regenerated on read.

```
CurriculumVersion(technologyId, version, generatorVersion, model, promptVersion, status)
```

- `status`: `GENERATING | ACTIVE | SUPERSEDED | FAILED`
- Exactly one `ACTIVE` version per technology.
- Users stay pinned to the version they started on until they opt into an upgrade, so
  concept IDs under their feet never change mid-learning.
- A failed generation leaves no `ACTIVE` version and is retried by a background job.

Regenerating on every app open would be slow, expensive, and non-deterministic — the user's
skill history is keyed to concept IDs, so unstable IDs would destroy their progress.

## Seeded technologies (§41)

Seeded as _data_ in `packages/curriculum/src/seed/`: JavaScript, TypeScript, Node.js, React,
Next.js, NestJS, MongoDB, PostgreSQL, Prisma, Docker, Linux, Git, GitHub, GitHub Actions,
Jenkins, Redis, Nginx, Traefik, System Design.

Seeds are curated where quality matters most (JavaScript, Node.js, React have hand-written
concept graphs) and AI-generated on first use otherwise. The seed format and the generated
format are identical, so there is one code path.

## What the user sees

```
Rust added.

Generating:
  Knowledge graph
  Prerequisites
  Curriculum
  Coding exercises
  Interview questions
  Review schedule
```

Each line resolves independently as its stage completes. Generation is asynchronous; the
technology appears immediately in a `GENERATING` state and becomes practisable when step 6
commits. Exercises (step 7) stream in afterwards.
