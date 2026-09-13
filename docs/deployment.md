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
   │ PM2 cluster × N   │        │ PM2 fork × M        │
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

| Process                | Mode    | Purpose                                                                                                           |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `forgeroutine-api`     | cluster | HTTP API. Instance count = CPU cores.                                                                             |
| `forgeroutine-sandbox` | fork    | Code execution workers. Fork mode deliberately — these spawn child processes and must not share a cluster master. |

Defined in `ecosystem.config.cjs` at the repository root, which is where PM2
looks by default.

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pnpm --filter @forgeroutine/database exec prisma migrate deploy
pnpm start                      # pm2 start ecosystem.config.cjs --env production
pm2 save
```

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

## Zero-downtime reloads

`pm2 reload forgeroutine-api` restarts cluster workers one at a time. The API implements
graceful shutdown: it stops accepting connections, drains in-flight requests, closes Prisma
and Redis, then exits. `kill_timeout` is 10s.

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
