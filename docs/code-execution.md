# Code Execution

## Non-negotiable rule

> Never execute arbitrary code in the API process. (§45.8)

User code is hostile input. It runs in a separate OS process, always, including in local
development. There is no "dev shortcut" that runs it in-process, because that shortcut would
inevitably reach production.

## Architecture

```
apps/api
   │  CodeExecutionPort  (application layer depends only on this)
   ▼
┌──────────────────────────────┐
│ driver: inline │ driver: queue│
└───────┬────────┴───────┬─────┘
        │                │
        │                ▼
        │          Redis (BullMQ)  ──▶  apps/sandbox workers (PM2)
        │                                        │
        └────────────────────────────────────────┤
                                                 ▼
                                    child process per run
                                    node --experimental-permission
                                       --allow-fs-read=<runDir>
                                       --max-old-space-size=<cap>
```

Both drivers end at the same `SandboxRunner`. The difference is only *who* invokes it:

- **`inline`** — the API spawns the child process itself. No Redis required. Correct for
  single-node development and small deployments. Still fully out-of-process.
- **`queue`** — the API pushes a job to Redis; `apps/sandbox` workers consume it. Correct for
  production: execution load cannot starve the API event loop, and workers scale separately.

`EXECUTION_DRIVER` selects between them. The application layer cannot tell the difference.

## Isolation controls

| Control | Mechanism | Status |
| --- | --- | --- |
| Execution timeout | `SIGKILL` on the process group after `EXECUTION_TIMEOUT_MS` | Enforced |
| Memory limit | `--max-old-space-size` + RSS watchdog | Enforced |
| Output limit | Stream truncated at `EXECUTION_MAX_OUTPUT_BYTES` | Enforced |
| Filesystem isolation | Node permission model, read-only, scoped to the run directory | Enforced |
| Environment stripping | Child receives an explicit minimal env; no secrets inherited | Enforced |
| Process limits | No `child_process` (blocked by the permission model) | Enforced |
| Network restrictions | Best-effort: `node:net`/`node:http` stubbed in the harness | **Partial** |
| CPU limit | Wall-clock timeout only | **Partial** |
| User/namespace isolation | Not implemented | **Not done** |

### Honest statement of the current threat model

The Node permission model plus a scrubbed environment stops accidental damage and casual
escapes. It is **not** a security boundary against a determined attacker, and the network
restriction in particular is a harness-level stub rather than a kernel-level control.

This is acceptable today because ForgeRoutine is single-tenant: the only person running code
is the person who owns the machine and the data. It becomes unacceptable the moment a second
untrusted user exists.

The port exists precisely so that the hardened backend can be swapped in without touching the
learning domain. The intended progression:

```
inline child process  →  queued workers  →  per-run container / gVisor / Firecracker microVM
```

Nothing above the `CodeExecutionPort` changes when that happens.

## The run protocol

A run is a directory under `EXECUTION_WORK_DIR`, deleted afterwards:

```
<runId>/
├── solution.mjs     the user's code, written verbatim
├── tests.mjs        the exercise's test cases
└── harness.mjs      the runner: imports both, executes cases, emits JSON
```

The harness writes exactly one line of JSON to stdout:

```json
{
  "ok": true,
  "cases": [
    { "name": "debounces rapid calls", "passed": true, "durationMs": 3 },
    { "name": "passes latest args", "passed": false, "expected": "[3]", "received": "[1]" }
  ],
  "stdout": "...",
  "consoleCalls": 2
}
```

Anything the user's code prints goes to a captured buffer, never mixed with the protocol
channel, so a `console.log` of a `}` cannot corrupt the result.

## Failure taxonomy

`COMPILE_ERROR`, `RUNTIME_ERROR`, `TIMEOUT`, `MEMORY_EXCEEDED`, `OUTPUT_EXCEEDED`,
`HARNESS_ERROR`, `INTERNAL_ERROR`.

Only `HARNESS_ERROR` and `INTERNAL_ERROR` are our fault; they are logged as errors and never
count against the user's skill record. The rest are legitimate learning signals.

## Language support

MVP: JavaScript and TypeScript (§30). TypeScript is type-checked, then stripped to JS before
execution — a type error is a `COMPILE_ERROR`, which is itself useful feedback.

Python, Rust, and Go are deferred until the container-based backend exists, because they need
real toolchain isolation rather than a permission flag.
