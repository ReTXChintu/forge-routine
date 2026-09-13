/**
 * What OpenAI has actually been billed for, from the `AIInteraction` table.
 *
 *   node scripts/ai-spend.mjs [--days 30]
 *
 * Read-only. Sits alongside `generation-plan.mjs`: that one says what the
 * next generation *would* cost, this one says what every call so far *did*.
 *
 * Prices are list price at the time of writing and are hard-coded, because
 * the alternative is an API call to find out what an API call costs. An
 * unpriced model is counted in tokens and reported as such rather than
 * silently costing nothing.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../apps/api/index.js'));
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/** USD per 1M tokens. */
const PRICE = {
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4.1': { in: 2.0, out: 8.0 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4.1-nano': { in: 0.1, out: 0.4 },
  'text-embedding-3-small': { in: 0.02, out: 0 },
  'text-embedding-3-large': { in: 0.13, out: 0 },
};

const daysFlag = process.argv.indexOf('--days');
const days = daysFlag === -1 ? null : Number(process.argv[daysFlag + 1]);
const since = days ? new Date(Date.now() - days * 86_400_000) : undefined;

function usd(model, promptTokens, completionTokens) {
  const price = PRICE[model];
  if (!price) return null;
  return (promptTokens * price.in + completionTokens * price.out) / 1e6;
}

async function main() {
  const where = since ? { createdAt: { gte: since } } : {};

  const rows = await prisma.aIInteraction.groupBy({
    by: ['agent', 'model'],
    where,
    _count: { _all: true },
    _sum: { promptTokens: true, completionTokens: true, latencyMs: true },
  });

  if (rows.length === 0) {
    console.log('No AI interactions recorded' + (since ? ` since ${since.toISOString()}` : ''));
    console.log('Either nothing has been generated, or the recording decorator is not wired in.');
    return;
  }

  let total = 0;
  let unpriced = 0;

  const table = rows
    .map((row) => {
      const promptTokens = row._sum.promptTokens ?? 0;
      const completionTokens = row._sum.completionTokens ?? 0;
      const cost = usd(row.model, promptTokens, completionTokens);

      if (cost === null) unpriced += 1;
      else total += cost;

      return {
        agent: row.agent,
        model: row.model,
        calls: row._count._all,
        in: promptTokens,
        out: completionTokens,
        'avg ms': Math.round((row._sum.latencyMs ?? 0) / row._count._all),
        USD: cost === null ? '?' : Number(cost.toFixed(4)),
      };
    })
    .sort((a, b) => (Number(b.USD) || 0) - (Number(a.USD) || 0));

  console.table(table);

  // Failures are billed too — a rejected generation still burned the input
  // tokens. Counting only the successes would understate the bill.
  const failed = await prisma.aIInteraction.count({ where: { ...where, outcome: { not: 'OK' } } });

  console.log(`\ntotal  $${total.toFixed(2)}`);
  if (unpriced > 0) console.log(`${unpriced} model(s) not in the price table — shown as "?"`);
  if (failed > 0) console.log(`${failed} call(s) failed; their input tokens are included above`);

  const first = await prisma.aIInteraction.findFirst({
    where,
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  const last = await prisma.aIInteraction.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (first && last) {
    console.log(`window ${first.createdAt.toISOString()} → ${last.createdAt.toISOString()}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
