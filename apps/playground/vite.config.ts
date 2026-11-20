import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command }) => ({
  resolve: {
    dedupe: ['react', 'react-dom'],
    // Development follows both workspace sources; production still exercises package exports.
    alias: command === 'serve' ? [
      { find: /^@cmdly\/react$/, replacement: fileURLToPath(new URL('../../packages/react/src/index.tsx', import.meta.url)) },
      { find: /^@cmdly\/core$/, replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) },
    ] : [],
  },
}));
