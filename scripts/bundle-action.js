import { build } from 'esbuild';

// Bundle the GitHub Action entry including dependencies.
// IMPORTANT: output CommonJS (.cjs) so Node can use require() for Node builtins
// even when the repo uses "type": "module".

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.cjs',
  bundle: true,
  platform: 'node',
  target: ['node20'],
  format: 'cjs',
  sourcemap: false,
  logLevel: 'info',
});
