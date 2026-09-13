/**
 * Propagates the root version to every app.
 *
 *   node scripts/bump-versions.mjs <version> [--stage]
 *
 * Run by release-it's `after:bump` hook, so the version release-it has just
 * written to the root `package.json` reaches the apps before anything is
 * committed or tagged.
 *
 * Only `apps/*` is bumped. Packages under `packages/` are internal and
 * referenced as `workspace:*`; giving them independent version numbers that
 * nothing reads would be churn in every release diff for no benefit.
 *
 * Flutter is the awkward one. Its version lives in `pubspec.yaml` as
 * `X.Y.Z+BUILD`, where the build number must increase monotonically for any
 * store to accept an upload — including across a version that goes
 * backwards. So the semver part is replaced and the build number is always
 * incremented, never reset.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [version, ...flags] = process.argv.slice(2);
const stage = flags.includes('--stage');

const ROOT = resolve(import.meta.dirname, '..');
const APPS = join(ROOT, 'apps');

if (!version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
  console.error(`Usage: node scripts/bump-versions.mjs <version>\nGot: ${version ?? '(nothing)'}`);
  process.exit(1);
}

const changed = [];

for (const name of readdirSync(APPS)) {
  const appDir = join(APPS, name);
  if (!statSync(appDir).isDirectory()) continue;

  changed.push(...bumpPackageJson(appDir), ...bumpPubspec(appDir));
}

for (const file of changed) {
  console.log(`  ${file.replace(`${ROOT}\\`, '').replace(`${ROOT}/`, '')}`);
}

if (stage && changed.length > 0) {
  // Staged here rather than left to release-it: release-it stages the files
  // it knows it wrote, and these are not among them. An unstaged bump means
  // a tagged release whose apps still claim the previous version.
  execFileSync('git', ['add', '--', ...changed], { cwd: ROOT, stdio: 'inherit' });
}

console.log(`${changed.length} file(s) set to ${version}`);

function bumpPackageJson(appDir) {
  const path = join(appDir, 'package.json');

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }

  // Edited as text rather than JSON.parse + stringify, which would reorder
  // nothing but would reformat everything and make the release diff useless.
  const updated = raw.replace(
    /^(\s*"version"\s*:\s*")[^"]*(")/m,
    (_match, before, after) => `${before}${version}${after}`,
  );

  if (updated === raw) return [];
  writeFileSync(path, updated);
  return [path];
}

function bumpPubspec(appDir) {
  const path = join(appDir, 'pubspec.yaml');

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }

  const current = /^version:\s*(\S+)\s*$/m.exec(raw);
  if (!current) return [];

  const [, existing] = current;
  const build = Number.parseInt(existing.split('+')[1] ?? '0', 10);

  // Always up, never reset. A store rejects an upload whose build number is
  // not higher than the last one it saw, whatever the semver says.
  const next = `${version}+${Number.isFinite(build) ? build + 1 : 1}`;
  if (existing === next) return [];

  writeFileSync(path, raw.replace(/^version:\s*\S+\s*$/m, `version: ${next}`));
  return [path];
}
