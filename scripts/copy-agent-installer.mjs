// Copies the freshly built ForgeRoutine Agent installer into the web app, under
// one fixed name, so the download link in Settings never has to change.
// Run by `pnpm agent:build` after `tauri build`.
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'apps/agent/src-tauri/target/release/bundle/nsis');
const target = join(root, 'apps/web/public/downloads/ForgeRoutine-Agent-Setup.exe');

const newest = readdirSync(bundle)
  .filter((name) => name.endsWith('-setup.exe'))
  .map((name) => join(bundle, name))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

if (!newest) {
  console.error(`No installer found in ${bundle}. Run tauri build first.`);
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(newest, target);
console.log(`Copied ${newest}\n    -> ${target}`);
