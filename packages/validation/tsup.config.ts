import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
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
