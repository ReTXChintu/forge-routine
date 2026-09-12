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
solution executes against its own tests *and every earlier step's*. A project is rejected
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
