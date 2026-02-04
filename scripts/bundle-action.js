import { build } from 'esbuild';

// Bundle the GitHub Action entry into dist/index.js including dependencies.
// This avoids having to ship node_modules in the action repo.

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: ['node20'],
  format: 'esm',
  sourcemap: false,
  logLevel: 'info',
});
