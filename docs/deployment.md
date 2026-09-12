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

## PM2 processes

| Process                | Mode    | Purpose                                                                                                           |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `forgeroutine-api`     | cluster | HTTP API. Instance count = CPU cores.                                                                             |
| `forgeroutine-sandbox` | fork    | Code execution workers. Fork mode deliberately — these spawn child processes and must not share a cluster master. |

Defined in `infrastructure/pm2/ecosystem.config.cjs`.

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pnpm --filter @forgeroutine/database exec prisma migrate deploy
pm2 start infrastructure/pm2/ecosystem.config.cjs --env production
pm2 save
```

`pm2 startup` once per machine so processes survive reboot.

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
