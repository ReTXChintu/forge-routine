# Interview Engine

Phase 6. Specified now because the skill model and knowledge graph must be able to feed it.

## Modes (§15)

| Mode                      | Duration  | Shape                                           |
| ------------------------- | --------- | ----------------------------------------------- |
| Quick Interview           | 5–10 min  | 3–5 rapid concept questions                     |
| Technical Interview       | 30–45 min | Conversational depth probing                    |
| Coding Interview          | 45–60 min | Problem + live code + follow-ups                |
| Debugging Interview       | 30 min    | Broken system, candidate diagnoses aloud        |
| System Design Interview   | 45–60 min | Open-ended design with trade-off pressure       |
| Senior Engineer Interview | 60–90 min | Mixed, with architecture and judgement emphasis |

## Question selection

Questions are chosen from the knowledge graph against the user's live skill state, not from a
fixed list. The selector deliberately targets weakness:

```
weight(concept) =
    2.5 × (1 − interviewReadiness)      attack the weakest
  + 1.5 × interviewImportance/5          respect the user's stated priorities
  + 1.0 × recencyOfLearning              recently learned needs proving
  + 0.5 × (1 − retention)                decayed knowledge needs testing
  − 2.0 × askedInLastTwoInterviews       do not repeat
```

Worked example from §15:

```
Docker networking   weak      → included, high weight
React hooks         strong    → at most one confirmation question
Node.js             medium    → included
NestJS              recent    → included, proving depth
```

A real interview is not uniformly distributed and neither is this one. Roughly 60% of the
time goes to weak and recently-learned areas, 25% to medium, 15% to confirming strength —
the last bucket exists because an interview that only hurts is not a useful rehearsal.

## Follow-up engine (§16)

The interviewer must react. After each answer the engine:

1. Grades the answer on `correctness`, `depth`, `specificity`, `confidence`.
2. Chooses a move:

| Answer quality      | Move                                                     |
| ------------------- | -------------------------------------------------------- |
| Shallow but correct | **Deepen** — push one level down                         |
| Wrong               | **Recover** — simpler sub-question in the same area      |
| Strong              | **Escalate** — a harder, adjacent, or practical scenario |
| Vague               | **Pin down** — demand a concrete example                 |
| Complete            | **Pivot** — move to the next concept                     |

Worked example:

```
Q1  Explain the Node.js event loop.
    → answer is correct but phase-level only          → DEEPEN
Q2  What happens to Promise callbacks relative to timers?
    → answer is strong                                → ESCALATE
Q3  What would happen if a CPU-heavy function blocks the event loop?
```

The engine keeps a running transcript and a per-concept depth counter, so it never asks three
questions at the same level and never loops. Maximum depth per concept is 4.

## Scoring (§17)

Ten dimensions, each 0–100: technical correctness, depth, problem solving, communication,
confidence, practical knowledge, architecture thinking, debugging, code quality, trade-off
awareness.

Not every mode scores every dimension. A Quick Interview does not produce a meaningful
`architectureThinking` score, so it returns `unscored` rather than a guess. Dimensions are
written to the skill model only when actually assessed.

## Report

```
Overall score
Strong areas            with the evidence that earned them
Weak areas              with the specific answer that revealed the gap
Recommended topics      fed from the knowledge graph's root-cause trace
Recommended exercises   concrete, linked, startable from the report
Interview readiness     per technology and overall
```

The report links every claim to a transcript moment. "Your Docker networking is weak" is
useless; "you could not explain why two containers on different bridge networks cannot reach
each other" is actionable.

## Readiness

```
interviewReadiness(technology) =
    0.30 × conceptMastery
  + 0.25 × explanationAbility
  + 0.25 × codingAbility (at assistance level >= 4)
  + 0.20 × mean(recent interview scores for this technology)
```

Coding ability counts only at level 4+ because interview coding is unassisted by definition.
A user who can only implement at level 1 is not interview-ready regardless of their
understanding, and the formula must say so.
