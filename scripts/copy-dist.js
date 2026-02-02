import fs from 'node:fs';
import path from 'node:path';

// This repo uses plain tsc output into dist/.
// In a production action, you'd typically bundle with @vercel/ncc.
// For MVP we'll keep it simple.

const dist = path.resolve('dist');
if (!fs.existsSync(dist)) {
  console.error('dist/ not found — did tsc run?');
  process.exit(1);
}
console.log('dist/ ready');
