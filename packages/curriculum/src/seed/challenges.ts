/**
 * Phase 9 challenges: system design, production incidents, terminal work.
 *
 * Hand-written rather than generated, for the same reason the terminal
 * scenarios are. A generated coding exercise can be verified by executing it.
 * A generated system-design brief cannot be verified against anything — the
 * only check available would be another model agreeing with it, which proves
 * consistency rather than correctness. These carry real numbers and real
 * failure modes, and a wrong one teaches a wrong fact about production.
 *
 * Each is attached to a technology by slug and placed on a concept by slug.
 * A challenge whose concept does not exist is skipped at seed time rather
 * than guessed at.
 */

export interface SeedChallenge {
  technologySlug: string;
  /** Concept it hangs off. Must exist in that technology's curriculum. */
  conceptSlug: string;
  slug: string;
  title: string;
  objective: string;
  difficulty: number;
  estimatedMinutes: number;
  spec: SeedChallengeSpec;
}

export type SeedChallengeSpec =
  | {
      kind: 'SYSTEM_DESIGN';
      brief: string;
      constraints: string[];
      expectedTopics: string[];
      sections: string[];
    }
  | {
      kind: 'INCIDENT';
      scenario: string;
      telemetry: string;
      rootCause: string;
      sections: string[];
    }
  | { kind: 'TERMINAL'; scenarioSlug: string };

const DESIGN_SECTIONS = [
  'What are you optimising for, and what are you giving up?',
  'The components and how a request flows through them',
  'Where the data lives and how it is keyed',
  'What happens when each part fails',
  'How you would know it is broken before a user tells you',
];

const INCIDENT_SECTIONS = [
  'What is your diagnosis, and which evidence supports it?',
  'What would you do first to stop the bleeding?',
  'What is the actual fix?',
  'What would stop this recurring?',
];

export const SEED_CHALLENGES: readonly SeedChallenge[] = [
  // -- System design --------------------------------------------------------
  {
    technologySlug: 'nodejs',
    conceptSlug: 'streams',
    slug: 'design-file-ingestion',
    title: 'Design a CSV ingestion service',
    objective:
      'Design a service that accepts CSV uploads up to 5GB and loads them into Postgres.',
    difficulty: 3,
    estimatedMinutes: 40,
    spec: {
      kind: 'SYSTEM_DESIGN',
      brief: `Customers upload CSV exports from their old system. Files range from 2KB to 5GB. Each row becomes a record in Postgres, and rows can fail validation individually.

The upload must not block. The customer needs to know, afterwards, which rows failed and why. A retry must not duplicate the rows that already succeeded.

Design it.`,
      constraints: [
        'Files up to 5GB; the API process has 512MB of memory',
        'Roughly 200 uploads a day, bursty — 50 can arrive in the same minute',
        'A failed upload must be resumable without duplicating successful rows',
        'Single Postgres instance, no Kafka, no managed queue service',
      ],
      expectedTopics: [
        'Streaming rather than buffering the file — 5GB will not fit in 512MB',
        'Where the file is stored between upload and processing',
        'Batching inserts rather than a round trip per row',
        'Idempotency: how a retry knows what already landed',
        'Backpressure when 50 uploads arrive at once',
        'Per-row error reporting without holding every error in memory',
        'What happens if the process dies halfway through a 5GB file',
      ],
      sections: DESIGN_SECTIONS,
    },
  },

  {
    technologySlug: 'javascript',
    conceptSlug: 'promises-and-async-await',
    slug: 'design-rate-limited-client',
    title: 'Design a client for a rate-limited API',
    objective:
      'Design a client library that calls a third-party API limited to 10 requests per second.',
    difficulty: 3,
    estimatedMinutes: 35,
    spec: {
      kind: 'SYSTEM_DESIGN',
      brief: `Your application calls a payment provider's API. The provider allows 10 requests per second per account and returns 429 with a Retry-After header when you exceed it. Exceeding it repeatedly gets the account suspended.

Your application runs as four processes behind a load balancer. Calls come from user requests, which are waiting, and from a nightly reconciliation job, which is not.

Design the client.`,
      constraints: [
        '10 requests per second, shared across four processes',
        'A 429 costs more than a delay: repeated 429s suspend the account',
        'User-facing calls must not queue behind the nightly batch',
        'Some calls are not safe to retry',
      ],
      expectedTopics: [
        'The limit is per account, not per process — four independent limiters do not work',
        'Where the shared counter lives and what happens when it is unreachable',
        'Priority: interactive calls ahead of batch work',
        'Which calls are idempotent and which must never be retried',
        'Backoff strategy, and why jitter matters with four processes',
        'What the caller sees while queued — a timeout, or an unbounded wait',
      ],
      sections: DESIGN_SECTIONS,
    },
  },

  // -- Production incidents -------------------------------------------------
  {
    technologySlug: 'nodejs',
    conceptSlug: 'the-event-loop',
    slug: 'incident-latency-cliff',
    title: 'Latency triples at exactly 10,000 users',
    objective: 'Diagnose a latency cliff that appears only above a specific load.',
    difficulty: 4,
    estimatedMinutes: 30,
    spec: {
      kind: 'INCIDENT',
      scenario: `At 09:40 your API's p99 latency went from 120ms to 4.2 seconds. It has stayed there. The service is a Node process behind nginx, reading from Postgres and Redis.

Nothing was deployed today. CPU is at 96% on one core and near zero on the others. Memory is flat. The database reports no slow queries. Redis latency is unchanged.

Requests are still being served — they are just slow. Restarting the process fixes it for about eleven minutes.`,
      telemetry: `-- Application metrics
09:38  rps=780   p50=41ms   p99=118ms   eventloop_lag_p99=3ms    heap=310MB
09:39  rps=910   p50=44ms   p99=131ms   eventloop_lag_p99=4ms    heap=318MB
09:40  rps=1040  p50=380ms  p99=4210ms  eventloop_lag_p99=3900ms heap=322MB
09:45  rps=1020  p50=402ms  p99=4380ms  eventloop_lag_p99=4100ms heap=325MB

-- Postgres
  slow queries (>100ms) in the last hour: 0
  active connections: 18 / 100
  cache hit ratio: 0.997

-- Redis
  p99 GET latency: 0.4ms (unchanged from yesterday)
  evicted_keys: 0

-- Host
  CPU core 0: 96%   cores 1-7: 2-4%
  load average: 1.9
  free memory: 22GB

-- A sampled CPU profile taken at 09:47, top frames by self time
  71.2%  JSON.parse                      (native)
  11.4%  buildPermissionSet              src/auth/permissions.js:88
   6.1%  Array.prototype.filter          (native)
   3.0%  pg.Result.parseRow              (native)

-- src/auth/permissions.js, unchanged for 8 months
  88:  const roles = JSON.parse(user.rolesJson);
  89:  return roles.flatMap((r) => r.permissions).filter(unique);

-- Recent non-deploy changes
  09:31  Marketing enabled the "Teams" feature flag for all accounts.`,
      rootCause: `The Teams feature flag gave every user a large roles document. \`buildPermissionSet\` runs \`JSON.parse\` synchronously on every request, and the document went from a few hundred bytes to tens of kilobytes. Parsing is synchronous and blocks the event loop, which is why one core is saturated, the other seven are idle, and event-loop lag tracks p99 exactly. The database and Redis are innocent — they were never the bottleneck. The restart helps for eleven minutes because a cold cache serves fewer permission lookups until it fills.

The tell is that event-loop lag rose in lockstep with p99 while every downstream dependency stayed flat. That combination means the process is blocked on its own CPU work, not waiting on anything.`,
      sections: INCIDENT_SECTIONS,
    },
  },

  {
    technologySlug: 'nodejs',
    conceptSlug: 'error-handling',
    slug: 'incident-silent-data-loss',
    title: 'Orders are vanishing, and nothing is failing',
    objective: 'Diagnose silent data loss with a clean error rate.',
    difficulty: 4,
    estimatedMinutes: 30,
    spec: {
      kind: 'INCIDENT',
      scenario: `Support has 14 tickets from customers who placed an order, got a confirmation page, and have no order.

The API error rate is 0.02%, normal. No alerts fired. The orders that exist look correct. The ones customers describe are not in the database at all — no row, no partial row, nothing.

It started some time in the last four days. Nobody is sure when.`,
      telemetry: `-- Order creation path, src/orders/create.js
  41:  const order = await db.orders.insert(payload);
  42:  await Promise.all([
  43:    inventory.reserve(order.id, payload.items),
  44:    email.sendConfirmation(order.id),
  45:    analytics.track('order_created', order.id),
  46:  ]);
  47:  return { ok: true, orderId: order.id };

-- Deploy history
  4 days ago, 14:20   "chore: move inventory reserve into the parallel block"
                      (previously awaited on its own line before line 42)

-- Application logs, a failing request
  14:02:11  INFO   order.create.start      user=8814
  14:02:11  INFO   db.insert ok            table=orders id=ord_91f2
  14:02:12  WARN   inventory.reserve       id=ord_91f2 status=409 detail="insufficient stock"
  14:02:12  INFO   order.create.complete   user=8814 ok=true

-- Database, same order id
  SELECT * FROM orders WHERE id = 'ord_91f2';
  (0 rows)

-- Transaction wrapper, src/db/with-transaction.js
  12:  const tx = await pool.begin();
  13:  try {
  14:    const result = await handler(tx);
  15:    await tx.commit();
  16:    return result;
  17:  } catch (error) {
  18:    await tx.rollback();
  19:    throw error;
  20:  }

-- Route handler, src/orders/route.js
  28:  const result = await withTransaction((tx) => createOrder(tx, req.body));
  29:  res.json(result);

-- Error rate over the period: 0.02%, flat.`,
      rootCause: `\`inventory.reserve\` rejects with a 409 when stock is short. Since the deploy four days ago it sits inside \`Promise.all\`, so its rejection propagates out of \`createOrder\`, out of \`withTransaction\`, and rolls back the transaction that inserted the order — deleting a row that was already written.

Nothing alerts because the rejection happens after the confirmation was already decided: the handler logs \`ok=true\` before the rollback lands, and whatever catches the error upstream is not counting it. The customer sees a confirmation page for an order that no longer exists.

Before the deploy, \`inventory.reserve\` was awaited on its own line, where its failure was handled and the order survived. Moving it into the parallel block changed which failures are fatal — the classic cost of "just parallelise it".

The tell is the log line \`db.insert ok\` for an id that does not exist. A row that was written and is now absent means a rollback, not a lost write.`,
      sections: INCIDENT_SECTIONS,
    },
  },

  // -- Terminal -------------------------------------------------------------
  {
    technologySlug: 'linux',
    conceptSlug: 'file-permissions',
    slug: 'terminal-deploy-key',
    title: 'A deploy key the agent refuses to load',
    objective: 'Fix the permissions on an SSH key so it can be used.',
    difficulty: 2,
    estimatedMinutes: 10,
    spec: { kind: 'TERMINAL', scenarioSlug: 'deploy-key-permissions' },
  },
  {
    technologySlug: 'linux',
    conceptSlug: 'text-processing',
    slug: 'terminal-error-window',
    title: 'Find when the incident started',
    objective: 'Extract the error lines from a service log.',
    difficulty: 2,
    estimatedMinutes: 10,
    spec: { kind: 'TERMINAL', scenarioSlug: 'find-the-error-window' },
  },
  {
    technologySlug: 'linux',
    conceptSlug: 'text-processing',
    slug: 'terminal-config-drift',
    title: 'Two config files, one difference',
    objective: 'Find the setting that differs between staging and production.',
    difficulty: 3,
    estimatedMinutes: 12,
    spec: { kind: 'TERMINAL', scenarioSlug: 'config-drift' },
  },
  {
    technologySlug: 'linux',
    conceptSlug: 'file-management',
    slug: 'terminal-reclaim-disk',
    title: 'The disk is full of rotated logs',
    objective: 'Delete rotated logs without touching the live one.',
    difficulty: 2,
    estimatedMinutes: 10,
    spec: { kind: 'TERMINAL', scenarioSlug: 'reclaim-disk' },
  },
  {
    technologySlug: 'linux',
    conceptSlug: 'file-management',
    slug: 'terminal-safe-restructure',
    title: 'Restructure a release without losing it',
    objective: 'Move a running release into a versioned directory safely.',
    difficulty: 3,
    estimatedMinutes: 15,
    spec: { kind: 'TERMINAL', scenarioSlug: 'safe-restructure' },
  },
];

export function challengesFor(technologySlug: string): SeedChallenge[] {
  return SEED_CHALLENGES.filter((challenge) => challenge.technologySlug === technologySlug);
}
