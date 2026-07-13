import { defineConfig } from 'tsup';

// Two entry points: the `fokus-mcp` CLI (a bin, gets the shebang) and the
// side-effect-free library consumed by the Fokus backend (ships .d.ts, no shebang).
export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: 'esm',
    platform: 'node',
    target: 'node20',
    clean: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: ['src/lib.ts'],
    format: 'esm',
    platform: 'node',
    target: 'node20',
    clean: false,
    dts: true,
  },
]);
