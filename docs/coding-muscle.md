# The Coding Muscle System

The most important subsystem in ForgeRoutine (§8). Everything else supports it.

## Premise

Understanding and implementation are different abilities that decay at different rates. AI
assistance preserves the first while eroding the second. ForgeRoutine measures them
separately and trains the second directly.

## Assistance ladder

Every exercise exists at one of five assistance levels. The level is a property of the
*attempt*, not only of the exercise — the same problem can be re-served at a higher level.

| Level | Name | Given to the user | Measures |
| --- | --- | --- | --- |
| 1 | Guided | Requirements, hints, signature, worked examples | Comprehension |
| 2 | Partial | Requirements, function signature | Implementation inside a frame |
| 3 | Recall | Problem statement only | Structure + algorithm recall |
| 4 | Blank | A one-line objective | Full independent production |
| 5 | Interview | Realistic problem, AI off by default | Performance under interview conditions |

Level 4 example — the entire prompt the user sees:

> Build an Express middleware that limits requests based on IP address.

No starter code, no signature, no test names.

## Promotion and demotion

Promotion requires **evidence, repeated**:

```
promote(user, concept):
  last3 ← last 3 attempts at current level for this concept
  require all(passed) 
      and mean(aiRequests) <= 1
      and no solution reveals
      and mean(timeToFirstCode) within 1.5× the level baseline
  → level + 1
```

Demotion is deliberately gentler than promotion, because the product's job is to rebuild
confidence (§10):

```
demote(user, concept):
  last2 ← last 2 attempts
  if all failed AND solution was revealed in both → level - 1
```

One bad day does not cost a level. Two consecutive give-ups do.

## Independent Coding Score

A single headline number over a 30-day rolling window, computed from evidence we can
actually observe:

```
ICS = 100 × Σ(w_i × component_i)

component                      weight   definition
────────────────────────────────────────────────────────────────────────────
independentCompletionRate      0.35     attempts passed with 0 AI requests
                                        ÷ total attempts
assistanceRestraint            0.20     1 − normalised(aiRequests per attempt)
solutionAbstinence             0.20     1 − (solution reveals ÷ attempts)
timeToFirstCode                0.10     1 − normalised(median TTFC)
reattemptSuccess               0.10     previously-failed concepts later
                                        passed unaided
levelWeight                    0.05     mean assistance level ÷ 5
```

Each component is clamped to [0,1]. Attempts are weighted by recency with a 30-day
half-life, so the score tracks current ability rather than history.

Guards:

- Fewer than 5 attempts in the window → score is reported as `INSUFFICIENT_DATA`, not 0.
  Showing a new user "12%" is both wrong and demoralising.
- Level-5 (interview) attempts count double toward `independentCompletionRate`.

## Signals collected per attempt

| Signal | How it is obtained | Trustworthy? |
| --- | --- | --- |
| `timeToFirstCodeMs` | First editor keystroke − exercise open | Yes |
| `aiRequestCount` | Server-side count of assistance calls | Yes, authoritative |
| `hintLevelsUsed` | Server-side | Yes |
| `solutionRevealed` | Server-side | Yes |
| `totalDurationMs` | Client, server-clamped | Mostly |
| `keystrokeCount` | Client editor events | Advisory only |
| `largePasteEvents` | Monaco paste events > 120 chars | Advisory only |
| `passed` / `testsPassed` | Sandbox execution | Yes, ground truth |

Client-reported signals are **advisory**: they inform coaching messages but never the score,
because they are trivially falsifiable. The score rests only on server-observed facts.
`largePasteEvents` is explicitly *not* framed to the user as cheating detection — it triggers
a question ("want to walk me through what you pasted?"), never an accusation.

## Anti-dependency intervention

When a user requests a solution within 60s of opening an exercise, twice in a row, the tutor
does not comply immediately. It responds:

> You're relying on assistance earlier than necessary. Let's try one smaller step first.

then offers the smallest possible decomposition. The solution remains available — a user who
insists gets it — but never as the *first* response. Shame is never used; the intervention is
framed as a smaller step, not a refusal.

## Blind Coding mode (§12)

A dedicated mode, not a level. Rules: no AI, no autocomplete, no solution, problem statement
only, optional timer. Evaluation happens strictly *after* submission and covers correctness,
code quality, time, architecture, edge cases, error handling, and independent completion.

Blind Coding attempts are the highest-signal evidence available and are weighted accordingly
in both the skill model and interview readiness.
