# Database

PostgreSQL is the source of truth for all learning state (§29). Prisma is the access layer.
Redis holds nothing that cannot be rebuilt from PostgreSQL.

## Conventions

- Primary keys are CUIDs (`cuid()`), not autoincrement integers — they are safe to expose in
  URLs and generate client-side.
- Every table has `createdAt` and `updatedAt`. Mutable user-owned rows also carry
  `archivedAt` for soft deletion (§5 — removing a technology must not destroy history).
- Money-like and score-like values are stored as `Float` in [0,1] internally and rendered as
  percentages at the edge. One representation, one place to change it.
- Enums are Prisma enums where the set is closed and owned by us (`SkillDimension`), and
  string slugs where the set is user-extensible (`Technology.slug`).
- Deletes are soft by default. Hard deletes exist only for `AIInteraction` retention pruning.

## Model groups

### Identity

`User`, `UserProfile`, `UserPreferences`, `RefreshToken`

Identity is deliberately decoupled from learning (§34). No learning table references an
auth provider; they reference `userId` only.

### Learning universe

`Technology`, `UserTechnology`, `CurriculumVersion`, `Concept`, `ConceptPrerequisite`

`Technology` is a global catalogue row. `UserTechnology` is the user's relationship to it
(status, priority, target proficiency, interview importance, frequency). This split is what
makes "add any technology" possible without per-user curriculum duplication.

### Skill model

`Skill`, `SkillEvent`, `SkillAssessment`, `ProgressSnapshot`

`Skill` is one row per `(user, concept)` holding all nine dimensions (§7) as separate
columns — not a JSON blob, because we query and aggregate them.

```
conceptMastery  recallStrength  codingAbility  problemSolving
debuggingAbility  explanationAbility  interviewReadiness
confidence  retention
```

`SkillEvent` is the append-only ledger of every change with its cause. `Skill` is a
materialised projection of that ledger. The ledger is what makes "why did my score drop?"
answerable, and lets scoring formulas be recomputed retroactively after a fix.

### Practice

`Exercise`, `ExerciseTestCase`, `ExerciseAttempt`, `CodeSubmission`, `ExecutionResult`,
`HintRequest`, `Assessment`

`ExerciseAttempt` is the unit the Coding Muscle system measures: it holds
`assistanceLevel`, `timeToFirstCodeMs`, `aiRequestCount`, `solutionRevealed`, and outcome.
A single attempt can have many `CodeSubmission` rows (each a run), and the attempt closes
when the user passes or abandons.

### Routine

`Routine`, `RoutineItem`, `LearningSession`, `ReviewSchedule`

`ReviewSchedule` is one row per `(user, concept)` with the SM-2-derived state:
`easeFactor`, `intervalDays`, `repetitions`, `dueAt`, `lapses`.

### Interview

`Interview`, `InterviewQuestion`, `InterviewAnswer`, `InterviewEvaluation`

### AI and analytics

`AIInteraction`, `TokenUsageDaily`

`AIInteraction` records agent, model, prompt version, token counts, latency, outcome, and a
hash of the input — not the raw prompt by default, for size. Raw capture is opt-in per
environment for prompt-regression debugging.

## Indexing

The queries that must stay fast:

| Query                      | Index                                                           |
| -------------------------- | --------------------------------------------------------------- |
| Today's due reviews        | `ReviewSchedule(userId, dueAt)` partial on `archivedAt IS NULL` |
| Weakest skills for a user  | `Skill(userId, codingAbility)`, `Skill(userId, conceptMastery)` |
| Attempts in the ICS window | `ExerciseAttempt(userId, createdAt DESC)`                       |
| Concept lookup by slug     | `Concept(technologyId, slug)` unique                            |
| Prerequisite traversal     | `ConceptPrerequisite(conceptId)` and `(prerequisiteId)`         |
| Daily token budget         | `TokenUsageDaily(userId, day)` unique                           |

## Migrations

`prisma migrate dev` locally, `prisma migrate deploy` in CI/deploy. Migrations are committed
and reviewed like code. `db push` is permitted only against a scratch database.

If `DATABASE_URL` points at a connection pooler, set `DIRECT_DATABASE_URL` to the direct
endpoint — Prisma migrations require a direct connection.

## Redis usage (§29)

| Purpose                         | Key shape                                  | TTL    |
| ------------------------------- | ------------------------------------------ | ------ |
| Knowledge-graph traversal cache | `kg:transitive:<conceptId>:<graphVersion>` | 24h    |
| Session scratch                 | `session:<sessionId>`                      | 12h    |
| Rate limiting                   | `rl:<scope>:<subject>`                     | window |
| Execution queue                 | BullMQ `execution`                         | —      |
| Daily token counter             | `ai:budget:<userId>:<day>`                 | 48h    |

Losing Redis entirely degrades performance and disables queued execution. It loses no
learning state. That property is a hard requirement, not an accident.
