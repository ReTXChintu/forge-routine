# ForgeRoutine — Product

> Forge your coding skills. Build your engineering mind.

## The problem this product exists to solve

A capable engineer has spent a long time pairing with AI. They can still _reason_ about
problems — architecture, trade-offs, what the solution should look like. What has decayed is
the motor skill: opening an empty file and producing working code without assistance.

Most learning platforms optimise for **completion**. ForgeRoutine optimises for **capability**:

> Never optimise for "the user finished the exercise."
> Optimise for "the user became capable of solving the exercise independently."

Every feature is judged against that sentence.

## Core loop

```
ROUTINE → LEARN → RECALL → WRITE → DEBUG → EXPLAIN → INTERVIEW → EVALUATE → ADAPT → ROUTINE
```

Each stage writes evidence into the skill model. The skill model drives the next routine.
The loop is closed — nothing in it is decorative.

## What ForgeRoutine is not

- Not a video course platform. There is no passive consumption path.
- Not a gamified XP/coin/streak app. Childish reward loops train the wrong behaviour.
- Not an AI pair programmer. The AI deliberately withholds code.
- Not a fixed curriculum. The user owns their learning universe (see `curriculum-engine.md`).

## The metrics that matter

| Metric                   | Why it exists                                    |
| ------------------------ | ------------------------------------------------ |
| Independent Coding Score | The headline number. Can you write code unaided? |
| Concept mastery          | Do you understand it?                            |
| Recall strength          | Can you retrieve it without a prompt?            |
| Coding ability           | Can you implement it?                            |
| Debugging ability        | Can you find a fault you did not create?         |
| Explanation ability      | Can you teach it?                                |
| Interview readiness      | Would you survive the room?                      |
| Retention                | Does it survive a month?                         |

Crucially these are **independent dimensions**, not one percentage. A user routinely scores
84% concept understanding and 51% code implementation on the same topic. That gap _is_ the
product's reason to exist, so the data model must be able to express it.

## Primary personas

**The rebuilding engineer (primary, v1).** Mid-to-senior, conceptually strong,
implementation-weak, preparing for interviews. Wants honest measurement and daily structure.

**The interview candidate (v1.5).** Has a date. Needs targeted weakness attack and realistic
adaptive interviews.

## MVP definition of done

> A user can open ForgeRoutine, select what they want to learn, learn a concept, write code
> from scratch, execute it, receive intelligent feedback, and have the system remember what
> they actually know.

Nothing past that sentence ships until that sentence is true.

## Feature phases

See `roadmap.md`. Phase 3 (Coding Muscle) is the highest-priority phase; Phases 1–2 exist to
make Phase 3 possible.
