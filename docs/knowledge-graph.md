# Knowledge Graph

Learning is modelled as a **directed acyclic graph of concepts**, not a flat list (§6).

## Node types

```
Technology ──owns──▶ Concept ──requires──▶ Concept
```

- **Technology** — a user-addable unit of the learning universe (`JavaScript`, `Docker`,
  `Rust`). Seeded, but never hardcoded in application logic (§41).
- **Concept** — an atomic learnable idea (`Closures`, `Microtasks`, `Multi-stage build`).
  Concepts carry difficulty, objectives, common mistakes, and exercise/question links.

## Edges

`ConceptPrerequisite(conceptId, prerequisiteId, strength)`

`strength` ∈ `HARD | SOFT`:

- **HARD** — you cannot meaningfully learn the concept without the prerequisite.
  `Microtasks` HARD-requires `Promises`.
- **SOFT** — it helps considerably but is not blocking.
  `Node.js Streams` SOFT-requires `Linux Pipes`.

Edges cross technology boundaries. This is the important part:

```
Node.js Streams ──requires──▶ Buffers            (Node.js)
                ──requires──▶ Async Programming  (JavaScript)
Docker Networking ──requires──▶ Networking       (Linux)
                  ──requires──▶ Processes        (Linux)
```

## Acyclicity

Prerequisite edges must form a DAG. A cycle would make the routine planner non-terminating.
Enforced at two levels:

1. `packages/curriculum` runs a DFS cycle check whenever edges are created or imported, and
   rejects the batch on detection.
2. The database has a unique constraint on `(conceptId, prerequisiteId)` and a check
   preventing self-edges. Cycles longer than 1 are an application-level invariant.

## The weakness-tracing algorithm

This is the graph's primary job. When a user struggles with concept `C`, we do not simply
schedule more of `C`. We ask _why_.

```
traceRootCause(user, C):
  weak ← []
  for each P in transitivePrerequisites(C), nearest-first:
      s ← skill(user, P)
      if s.conceptMastery < THRESHOLD or s.codingAbility < THRESHOLD:
          weak.push({ concept: P, depth, deficit })
  if weak is empty:
      return { cause: 'CONCEPT_ITSELF', target: C }
  return { cause: 'PREREQUISITE_GAP', targets: deepest-first(weak) }
```

Worked example from §6:

```
User fails:  Node.js Streams
Prereqs:     Buffers (mastery 34%), EventEmitter (81%), Async (77%)
Result:      PREREQUISITE_GAP → strengthen Buffers before retrying Streams
```

The routine engine consumes this and inserts a Buffers block ahead of any Streams block.
Traversal is breadth-first by depth so the _nearest_ unmet prerequisite wins; we do not send
a user back to "Variables" because of one bad Streams attempt. Depth is capped
(`MAX_TRACE_DEPTH = 3`) for the same reason.

## Readiness

A concept is **unlocked** when every HARD prerequisite has `conceptMastery >= 0.6`.
Soft prerequisites never block; they only influence ordering and generate advisory notices.

`readiness(C) = min over HARD prereqs of (mastery / 0.6)`, clamped to [0,1].

## Traversal caching

Transitive prerequisite sets are pure functions of the graph, which changes rarely. They are
computed in `packages/curriculum` and cached in Redis under
`kg:transitive:<conceptId>:<graphVersion>`. `graphVersion` bumps on any edge mutation, which
invalidates the whole namespace without key-by-key deletion.

## Growth

When a user adds a technology, the curriculum generator (see `curriculum-engine.md`) produces
concepts _and_ proposes prerequisite edges — including edges into technologies the user
already has. Adding `Kubernetes` should wire it to existing `Docker`, `Linux`, and
`Networking` nodes rather than creating an island.
