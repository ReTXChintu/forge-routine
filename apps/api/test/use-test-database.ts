/**
 * Points the e2e suite at a test database, and refuses to run otherwise.
 *
 * The suites register users, plant curriculum and delete what they planted.
 * They used to run against the root .env's DATABASE_URL — which is shared by
 * local development *and* the deployed server, so it is production. On
 * 2026-10-06 one cleanup line received an undefined id, Prisma read
 * `{ id: undefined }` as no filter at all, and it deleted every technology;
 * the cascade took the whole curriculum and every user's progress with it.
 * Recovery took a point-in-time restore.
 *
 * A rule written down was not enough to stop that, so this makes it
 * mechanical. Runs before any test file is loaded, so nothing has opened a
 * connection yet when DATABASE_URL is swapped.
 */

const testUrl = process.env.TEST_DATABASE_URL?.trim();
const live = process.env.DATABASE_URL?.trim();

if (!testUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. The e2e suite writes and deletes data, so it will not run ' +
      'against DATABASE_URL, which is shared with the deployed server. Create a Neon branch for ' +
      'tests and put its connection string in TEST_DATABASE_URL.',
  );
}

/** Host and database, ignoring credentials and query options. */
function identity(url: string): string {
  try {
    const parsed = new URL(url);
    // The pooled and direct hosts of one Neon endpoint differ only by
    // "-pooler"; treat them as the same database.
    return `${parsed.hostname.replace('-pooler', '')}${parsed.pathname}`;
  } catch {
    return url;
  }
}

if (live && identity(testUrl) === identity(live)) {
  throw new Error(
    'TEST_DATABASE_URL points at the same database as DATABASE_URL. Refusing to run the e2e ' +
      'suite against production.',
  );
}

process.env.DATABASE_URL = testUrl;
// Prisma prefers the direct URL for some operations; it must move with it.
process.env.DIRECT_DATABASE_URL = testUrl;

export {};
