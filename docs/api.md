# API

REST, versioned under `/api/v1` (§35). OpenAPI is generated from the NestJS decorators and
served at `/api/docs` outside production.

## Conventions

- Every request body and query string is validated by a Zod schema from
  `@forgeroutine/validation` via a global `ZodValidationPipe`. Nothing reaches a use-case
  unvalidated (§45.6).
- Responses are DTOs, never Prisma models. The database shape is not the API contract.
- Errors use RFC 9457 `application/problem+json`:

```json
{
  "type": "https://forgeroutine.dev/errors/exercise-locked",
  "title": "Exercise locked",
  "status": 409,
  "detail": "Complete the prerequisite concept 'Buffers' first.",
  "instance": "/api/v1/exercises/clx.../start"
}
```

- Pagination is cursor-based: `?cursor=<id>&limit=<n>`, response
  `{ items, nextCursor, hasMore }`.
- Mutating endpoints accept an optional `Idempotency-Key` header; submissions use it so a
  double-click cannot create two attempts.

## Resources

```
/api/v1/auth
  POST   /register
  POST   /login
  POST   /refresh
  POST   /logout
  GET    /me

/api/v1/users
  GET    /me/preferences
  PATCH  /me/preferences

/api/v1/technologies
  GET    /                       catalogue, searchable
  GET    /mine                   the user's universe
  POST   /mine                   add a technology
  PATCH  /mine/:id               priority, target, frequency, importance
  POST   /mine/:id/pause
  POST   /mine/:id/resume
  DELETE /mine/:id               soft delete (archive)
  GET    /:id                    detail + curriculum status

/api/v1/concepts
  GET    /?technologyId=         concepts for a technology
  GET    /:id                    concept detail + prerequisites + readiness
  GET    /:id/graph              local subgraph for visualisation

/api/v1/skills
  GET    /                       all nine dimensions per concept
  GET    /summary                per-technology rollup, skill tree
  GET    /weakest?limit=         weakest-skill list for the dashboard

/api/v1/sessions
  POST   /                       start a learning session
  GET    /:id
  POST   /:id/complete

/api/v1/exercises
  GET    /?conceptId=            list
  GET    /:id                    detail at the user's assistance level
  POST   /:id/attempts           open an attempt (starts the TTFC clock)

/api/v1/submissions
  POST   /                       run code against tests
  GET    /:id                    execution result + AI evaluation

/api/v1/ai
  POST   /hint                   assistance ladder request
  POST   /explain                concept explanation
  POST   /review                 code review

/api/v1/routines
  GET    /today
  POST   /generate
  PATCH  /items/:id              mark done / skipped

/api/v1/progress
  GET    /overview               dashboard payload
  GET    /independence           Independent Coding Score + trend

/api/v1/interviews                (Phase 6)
```

## Vertical-slice contract

The first milestone (§48) exercises exactly this path:

```
POST /auth/register        → user
POST /technologies/mine    → adds JavaScript
GET  /concepts?technologyId=  → concept list
GET  /concepts/:id         → concept detail
POST /sessions             → session started
GET  /exercises?conceptId= → exercise served at the user's level
POST /exercises/:id/attempts  → attempt opened
POST /submissions          → executed + evaluated
GET  /progress/overview    → skills updated, next action recommended
```

## Rate limiting

Per-user, per-scope, Redis-backed (in-memory fallback when Redis is disabled):

| Scope | Limit |
| --- | --- |
| `auth` | 10 / 15 min |
| `ai` | 60 / hour |
| `execution` | 120 / hour |
| default | 300 / 15 min |

## Auth

Bearer access token (JWT, 15 min) plus a rotating refresh token stored hashed in
`RefreshToken` with reuse detection. Refresh tokens are single-use; presenting a used token
revokes the whole family.
