# Deployment

ForgeRoutine deploys with **PM2**. There are no containers anywhere in the pipeline.
PostgreSQL and Redis are external managed services reached by connection string.

## Topology

```
                      ┌──────────────┐
   internet ──443──▶  │    nginx     │  TLS, static web, reverse proxy
                      └──┬───────┬───┘
                         │       │
        /api/*  ─────────┘       └──────────  /  (static SPA from apps/web/dist)
           │
           ▼
   ┌───────────────────┐        ┌────────────────────┐
   │ forgeroutine-api  │        │ forgeroutine-sandbox│
   │ PM2 fork × 1      │        │ PM2 fork × 1        │
   └─────┬─────────┬───┘        └──────────┬─────────┘
         │         │                       │
         ▼         ▼                       ▼
   PostgreSQL    Redis ◀───── execution queue ─────┘
   (external)   (external)
```

## Ports

| Process             | Port  |
| ------------------- | ----- |
| Web (static bundle) | 50004 |
| API                 | 50005 |

Both are bound locally and reached through nginx, which is the only thing
listening on 80 and 443.

## PM2 processes

| Process                | Mode | Instances | Purpose                                                                                        |
| ---------------------- | ---- | --------- | ---------------------------------------------------------------------------------------------- |
| `forgeroutine-web`     | fork | 1         | Static bundle on 50004, SPA fallback on.                                                       |
| `forgeroutine-api`     | fork | 1         | HTTP API on 50005.                                                                             |
| `forgeroutine-sandbox` | fork | 1         | Code execution. Fork always — these spawn child processes and must not share a cluster master. |

One instance each, sized for about ten users. See [Restarts](#restarts) for what that
costs.

`pnpm start` brings up all three. Use `pnpm start:inline` to leave the sandbox worker
out, which is correct only when `EXECUTION_DRIVER=inline` — without Redis the worker
exits immediately and crash-loops, painting the dashboard red while nothing is actually
wrong.

Getting that backwards in the other direction is the worse mistake and a quiet one:
with `EXECUTION_DRIVER=queue` and no worker running, submissions are accepted, written
to Redis, and sit there forever with nothing consuming them. Nothing errors.

## Execution driver

`inline` is the default and is supported in production.

It used to be forbidden there, on the grounds that it would "block API workers". That
was never quite true: inline spawns a sandbox child process and awaits it, which is
async I/O, not event-loop work. Code has always run out-of-process — `inline` describes
who starts it, not where it runs.

The real risk was that inline had no backpressure. N simultaneous submissions meant N
child processes, each allowed `EXECUTION_MAX_MEMORY_MB`, with nothing to stop them.
`InlineExecutionAdapter` now honours `EXECUTION_CONCURRENCY` exactly as the queue workers
do: past the limit, submissions wait. Config also refuses to boot if
`EXECUTION_CONCURRENCY × EXECUTION_MAX_MEMORY_MB` exceeds 1GB, which is the out-of-memory
the old rule was really guarding against.

So the driver choice is now about topology. Use `queue` to spread execution across
machines; use `inline` when one box is enough, and skip Redis entirely.

### Redis is not optional under `queue`

The API refuses to boot if `EXECUTION_DRIVER=queue` and `REDIS_ENABLED=false`. What it
does **not** refuse is a Redis that is configured but unreachable: the process starts
normally, logs `Redis error` on a loop, and serves requests. Only code execution is
broken, and only when somebody submits.

`GET /api/v1/health/ready` is what catches this — it reports
`{"status":"degraded","database":true,"redis":false}`. Note that it answers **200 even
when degraded**, deliberately, because the API is still partly usable. Anything
monitoring this must read the body; a status-code check alone will call a box healthy
while nobody can run any code on it.

Defined in `ecosystem.config.cjs` at the repository root, which is where PM2
looks by default.

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pnpm db:deploy                  # prisma migrate deploy
pnpm start                      # pm2 start ecosystem.config.cjs --env production
pm2 save
```

**`db:deploy` on a server, never `db:migrate`.** They are different Prisma
commands wearing similar names. `migrate deploy` applies what is pending and
stops. `migrate dev` is a development tool: it compares the migration history
against the files, and when they disagree — an edited migration, a rolled-back
row left behind — its remedy is to _drop the database and rebuild it_. It will
say so and wait for a keypress, which is the only reason production data has
survived it so far.

If `db:deploy` reports a checksum mismatch, do not reach for `migrate reset`.
Compare the recorded checksum against the file first:

```sql
SELECT migration_name, checksum, finished_at, rolled_back_at
FROM _prisma_migrations ORDER BY started_at;
```

`sha256sum` of the migration file is what the checksum should equal. A row with
`rolled_back_at` set is a failed attempt Prisma still counts; deleting that one
row is usually the whole fix.

`pm2 startup` once per machine so processes survive reboot.

## Releasing

```
pnpm release          # choose the bump interactively
pnpm release:minor    # or name it
pnpm release:dry      # show what would happen, change nothing
```

`release-it` bumps the root `package.json`, then `scripts/bump-versions.mjs`
propagates that version to every app under `apps/`. Packages under
`packages/` are deliberately left alone: they are internal, referenced as
`workspace:*`, and independent numbers nothing reads would be churn in every
release diff.

Flutter is the exception to the simple rule. Its version lives in
`pubspec.yaml` as `X.Y.Z+BUILD`, and the build number must increase
monotonically for any store to accept an upload — even across a version that
goes backwards. So the semver part is replaced and the build number only
ever increments.

Lint, typecheck and unit tests run before anything is bumped. End-to-end
tests are not in that list: they need a live database, and CI already runs
them on every push to main.

Tagging does **not** deploy. Publishing the GitHub release does.

Set `GITHUB_TOKEN` and release-it publishes the release itself, so the
release and the deploy follow from one command. Without it release-it prints
a URL, the tag exists, and nothing ships until someone publishes the release
by hand — which is a reasonable way to work if you want a look at the notes
first.

## Continuous deployment

`.github/workflows/cd.yml` runs when a GitHub release is **published**. It
builds the release APK, keeps it as a workflow artifact, and places it on
the server.

Published rather than tagged, deliberately. `pnpm release` pushes the tag
and the commit together, so a tag trigger fires before anyone has read the
release notes and with no way to stop it. Publishing is a separate,
deliberate act — and re-deploying an old version becomes a matter of
re-publishing that release rather than deleting and re-pushing a tag.

Required secrets:

| Secret               | What it is                               |
| -------------------- | ---------------------------------------- |
| `DEPLOY_SSH_KEY`     | Private key for the deploy user          |
| `DEPLOY_HOST`        | Server hostname or address               |
| `DEPLOY_USER`        | SSH user (defaults to `root`)            |
| `DEPLOY_PORT`        | SSH port (defaults to `22`)              |
| `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan -p <port> <host>` |

And variables:

| Variable              | What it is                                                       |
| --------------------- | ---------------------------------------------------------------- |
| `MOBILE_API_BASE_URL` | Public API base compiled into the APK                            |
| `DEPLOY_APK_DIR`      | Where the APK goes (default `/opt/var/spendlog/apps/web/public`) |

`DEPLOY_KNOWN_HOSTS` is required rather than optional. Accepting any host
key would mean the job trusts whatever answers on that address, which is the
entire attack — a stolen DNS record and the deploy key walks out.

The APK is uploaded under a dot-prefixed name and then moved into place.
`mv` within a filesystem is atomic and `scp` is not, so without it anyone
downloading mid-deploy gets a truncated APK that installs and then fails to
launch.

It is written to two places. Vite copies `public/` into `dist/` at build
time and PM2 serves `dist/`, so an APK left only in `public/` is unreachable
until the next web build — the download button would 404 with the file
sitting on disk. `public/` is the copy that survives a rebuild; `dist/` is
the one being served now.

The build fails if `MOBILE_API_BASE_URL` is unset rather than shipping an
APK pointed at an emulator loopback, which is useless on a real phone.

## Restarts

Every process is a single fork-mode instance. The target is about ten users, and one
Node process serves that without noticing — the API is I/O-bound, and code execution
happens in a separate process anyway.

**Restarts are therefore not zero-downtime.** That property comes from cluster mode,
where PM2 starts a replacement worker before retiring the old one. With one process
there is nothing to hand over to, so `pnpm restart` costs a second or two of refused
connections.

It is still _graceful_, which is a different thing: the API stops accepting connections,
drains in-flight requests, closes Prisma and Redis, then exits, with `kill_timeout` at
10s. Nobody loses a submission mid-flight. Somebody arriving during the gap gets a
failure.

At this scale that is the right trade — the alternative is carrying cluster mode, more
memory and a more complicated shutdown path to protect a window nobody is likely to be
in. If it stops being the right trade, set the API to `instances: 'max'` and
`exec_mode: 'cluster'`; nothing else in the config depends on the mode.

The sandbox worker traps shutdown, stops claiming new jobs, and kills any running child
process group before exiting so no orphaned `node` processes survive a deploy.

## Secrets

Never in source control (§45.9). On the server, `.env` sits outside the repo directory and
is referenced by PM2 via `env_file`-style loading in the ecosystem config. File mode `0600`,
owned by the service user.

Required in production:

```
DATABASE_URL  DIRECT_DATABASE_URL  REDIS_URL  REDIS_ENABLED=true
JWT_ACCESS_SECRET  JWT_REFRESH_SECRET  OPENAI_API_KEY
EXECUTION_DRIVER=queue
```

`EXECUTION_DRIVER` must be `queue` in production so code execution cannot block API workers.

## nginx

`infrastructure/nginx/forgeroutine.conf`:

- TLS termination, HTTP→HTTPS redirect, HSTS.
- `/api/` proxied to the API with a 65s read timeout (AI streaming responses are slow).
- SSE/streaming endpoints have buffering disabled.
- Static SPA served with `try_files $uri /index.html`; hashed assets get a one-year
  immutable cache, `index.html` gets `no-cache`.
- Request body cap of 1 MB — code submissions are text.

## Database migrations on deploy

`prisma migrate deploy` runs before the new code starts. Migrations must therefore be
backward-compatible with the currently running version for the duration of the reload:
add columns nullable, backfill, then tighten in a later release. Never rename a column in
one step.

## Health and readiness

| Endpoint                   | Meaning                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `GET /api/v1/health/live`  | Process is up. Never touches dependencies.                          |
| `GET /api/v1/health/ready` | Postgres reachable, Redis reachable if enabled, migrations current. |

nginx routes traffic on readiness; PM2 restarts on liveness failure.

## Backups

PostgreSQL is the only stateful thing worth backing up — Redis is disposable by design.
Daily `pg_dump`, 30-day retention, and a restore rehearsal before any schema-heavy release.
