import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/main.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  // See the note in packages/*/tsup.config.ts: cleaning under --watch deletes
  // output that dependent watchers are already reading.
  clean: !options.watch,
}));
