import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  treeshake: true,
  splitting: false,
  target: 'es2020',
  outDir: 'dist',
  // Compatible with Node.js, Bun, Deno, browsers
  platform: 'neutral',
  // No external dependencies - zero deps
  noExternal: [],
  // Shims for compatibility
  shims: true,
  // Banner for ESM
  banner: {
    js: '/* @lelemon/sdk - LLM Observability */',
  },
});
