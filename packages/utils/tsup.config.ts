import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  /**
   * A second entry so the browser can take one module without the barrel.
   *
   * `src/index.ts` re-exports secret-box, which imports node:crypto — so any
   * web import of this package drags Node's crypto into the bundle and the
   * build fails on it. Subpath entries let a browser consumer take exactly
   * what it needs, without a second copy of the code living in the web app.
   */
  entry: ['src/index.ts', 'src/fence-code.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  /**
   * Never clean in watch mode.
   *
   * `turbo run dev` builds every package before starting the watchers, but a
   * cleaning watcher then deletes the `dist/` it just produced. The API's tsc
   * is already watching those files, sees `index.js` with no `index.d.ts`, and
   * reports a wall of spurious TS7016 "could not find a declaration file"
   * errors before the rebuild lands.
   *
   * A one-shot build still cleans, so stale output never ships.
   */
  clean: !options.watch,
  treeshake: true,
}));
