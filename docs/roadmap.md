# Roadmap

Phases are ordered by dependency, not by appeal.

Phases 1–8 are complete. A user can pick technologies, get a generated and ordered
roadmap, work through it a day at a time, write code and have it graded, build projects
that make them compose what they learned, be interrupted at boundaries by recall prompts
that keep it from fading, and sit a live adaptive interview that tells them where they
would be caught out. The design behind the path is in `learning-path.md`.

Phase 9 added the engineering work a coding sandbox cannot express — system design,
production incidents, and a simulated shell. What remains is Phase 10: putting it on a
phone.

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

## Phase 5 — Projects and Checkpoints — **done**

Every phase of a roadmap ends in a project — in practice every 5–6 lessons.

- `PROJECT` exercises with ordered `ProjectStep` children, each submitted and graded
  separately; test cases hang off the step, not the exercise
- Progressive requirements (§14): each step's starter code is the previous step's
  reference solution, so the work accumulates instead of restarting
- Tech-lead review by the reviewer agent: finds issues, explains them, does not rewrite
- Checkpoint semantics — passing the tests is necessary, not sufficient. A finished
  project carrying critical or major review issues returns the user to it with a
  specific list rather than waving them through
- Generated one per roadmap phase, anchored to that phase's last concept

Projects are the only thing that exercises composition. Isolated drills never do, which
is why `problemSolving` and `architecture` were starved of evidence before this.

**A project is verified the way it will be graded.** Every step's reference solution runs
against its own tests _and every earlier step's_, and the project is rejected whole if
any step fails. On the first live run this immediately rejected one of two generated
projects: step 2's solution broke a step 1 test. That project was unwinnable, and without
the cross-step check it would have shipped — the user would have spent the evening
hunting for a fault in their own code that was actually in ours.

The grouping constant is imported from the roadmap builder rather than repeated. The
roadmap closes each phase by looking for a `PROJECT` exercise among that phase's
concepts, so if the two groupings ever disagreed the project would land in a phase that
never looks for it and silently degrade to a checkpoint.

## Phase 6 — Recall Prompts and the Question Bank — **done**

Short conceptual questions between activities, never during coding.

- ~~Question bank generated per concept~~ — done in Phase 4
- ~~Delivery at boundaries only~~: surfaced between routine items, never during coding
- ~~Selection from the existing `ReviewSchedule`~~, so prompts are _due_ rather than
  random
- ~~Feeds `recallStrength` and `retention`~~, two of the nine dimensions nothing else
  measures
- ~~Wrong answers schedule, they do not punish~~

Where a prompt may appear is a product rule, not a styling choice. An interruption
mid-problem destroys the exact mental state the product exists to build, and teaches the
user to dismiss prompts unread — at which point the spaced-repetition data becomes noise
and every schedule built on it is wrong. Nothing is coloured in the UI until an answer is
committed, so the right option cannot be read off the styling.

## Phase 7 — Daily Routine — **done**

A slice of the roadmap rather than an independent planner.

- Today's items drawn from the roadmap backlog, in order
- Reviews first: a concept that decays takes the work that built it with it, so review
  outranks new ground even when new ground is more fun
- Fitted to available time (§21). An item that overruns the budget is included only when
  nothing else has been planned — better offered than silently withheld, but it must not
  crowd out a shorter day's work
- Every item carries the reason it is there. An opaque routine is not a trusted one
- Never padded to fill the time. A routine the user cannot finish is one they stop
  opening

Deliberately after the roadmap: a routine generated independently of a path would quietly
diverge from it, and two planners disagreeing is worse than one.

## Phase 8 — Interview Guide and Engine — **done**

The guide tells you what to rehearse. The engine is the rehearsal.

**Guide** — a readiness dossier per technology: where you would be caught out, ordered by
what is worth fixing first. Derived on read, never stored; a dossier that goes stale the
moment you practise anything is worse than none, because it still gets acted on. Topics
are ordered shaky, then weak, then untouched, then solid — rereading what you already
know is the most comfortable way to waste the time you have left. Overall readiness stays
`null` below five practised concepts: one well-drilled concept is not 90% ready.

**Engine** (§15–17) — live adaptive interviews. Each answer is graded as it is given and
the grade picks the next move: `DEEPEN` when correct but shallow, `RECOVER` when wrong,
`ESCALATE` when strong, `PIN_DOWN` when vague, `PIVOT` when the area is covered. Depth is
capped per mode and enforced in code rather than trusted to the model — an interviewer
who will not leave one topic stops gathering information and starts grinding the
candidate down.

Nothing is graded in front of the user. Feedback between turns would make it a tutorial,
and they would start answering for approval rather than saying what they think.

### The scoring bug the first live run found

The report agent returned `overallScore: 1.00` beside six weak areas describing a
candidate who answered nothing correctly. The prose was right and the number was noise —
and the number is what writes to the skill model.

Asking one model pass to re-score a transcript it has already graded turn by turn is
asking it to disagree with itself. `technicalCorrectness`, `depth` and `confidence` are
now the means of the per-answer grades; the report agent supplies only what a
transcript-level read can genuinely see, plus the prose. The same run then reported 0.13
overall against 0.17 correctness.

`confidence` is reported and deliberately excluded from the overall score. Sounding
certain is not the same as being correct, and rewarding it would train the wrong habit.

## Phase 9 — Advanced Engineering — **done**

The three things a senior interview always reaches that a coding drill cannot test.
None of them is graded by running the user's code.

**System design** — a brief with real numbers and real constraints. The reviewer names
gaps and refuses to design it for them; a gap explanation containing a patch is stripped,
the same guard the code reviewer uses.

**Production incidents** — telemetry from an outage, and a diagnosis written against it.
The real cause is withheld until the user has committed to one, for the same reason a
debugging exercise withholds its bug explanation (§13). The telemetry itself is shown in
full: in a real incident the signal was always there, and hiding some of it would test
luck rather than diagnosis. `foundRootCause` and `reasoningQuality` are scored
separately, because guessing right without using the evidence demonstrates nothing and
reasoning carefully to a wrong answer demonstrates a great deal.

**Terminal** — a simulated POSIX shell in `@forgeroutine/terminal`. Graded on the end
state, not on which commands were typed: there are five ways to remove a file, and a
scenario that accepts one of them tests recall of an incantation rather than whether the
user can operate a machine.

### Why the shell is simulated

Running real shell commands would mean either handing untrusted input a real filesystem
or building the container isolation this project has deliberately deferred
(`code-execution.md`). A simulation cannot be escaped from, because there is nothing
underneath it to escape to.

The honest cost: commands behave the way the simulator says they do. So the command set
is small, permission bits are **enforced rather than displayed** — a `chmod` that changes
a number nothing reads teaches that permissions are cosmetic, which is the exact
misunderstanding these exercises exist to correct — and anything ambiguous is refused
rather than guessed at. Backticks, `$()`, `||` and background jobs return "this shell
does not support that" instead of an approximation, because a shell that quietly does the
wrong thing with quoting teaches the user that quoting works that way.

Scenarios and challenges are hand-written, not generated. A generated coding exercise can
be verified by executing it; a generated Linux scenario could only be verified against
this simulator, which would prove it consistent with the simulation rather than correct
about Linux. Every curated scenario carries a reference solution in the test suite — the
same gate the sandbox applies to generated exercises — plus a test that it fails on an
empty transcript and tests that it rejects the plausible near misses.

### Bugs the tests and the live run caught

- `&(?!&)` matched the second ampersand of `&&` and rejected every chained command.
- Globbing only handled a trailing `*`, so `rm *.log` silently did nothing.
- Commands did not terminate their output, so `echo a > f; echo b >> f` produced `ab`.
- Every terminal challenge failed to parse: the spec schema required `task` and `checks`
  that the seed did not write, so five challenges silently never appeared.
- Jest's `testRegex` was `'.*\.spec\.ts$'` written with single backslashes, which JS
  drops — the dots matched any character and pulled the source file `challenge-spec.ts`
  in as a test suite.
- **The design reviewer scored 1.00 on every dimension of a design it had just described
  as having two critical flaws.** Exactly the failure the interview report had. The
  dimension scores were removed from the model's contract: it now tags each gap with the
  dimension it belongs to, says which dimensions the submission engaged with at all, and
  the scores are computed from those. A gap counts as evidence about its dimension even
  when the model forgets to list it as addressed — otherwise a real penalty is discarded
  as "not tested". The same design now scores 0.05 on scalability and failure handling.

The pattern is now established twice: **ask the model for observations, compute the
numbers in code.** Models are reliable at "is this a gap, and how bad" and unreliable at
turning that into a score.

## Phase 10 — Mobile — **next**

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
