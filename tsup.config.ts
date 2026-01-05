import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    next: 'src/integrations/next.ts',
    lambda: 'src/integrations/lambda.ts',
    express: 'src/integrations/express.ts',
    hono: 'src/integrations/hono.ts',
    integrations: 'src/integrations/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  treeshake: true,
  splitting: false,
  target: 'es2020',
  outDir: 'dist',
  // Compatible with Node.js, Bun, Deno
  platform: 'neutral',
  // Mark Node.js built-ins as external (resolved by runtime)
  external: ['async_hooks'],
  // Shims for compatibility
  shims: true,
  // Banner for ESM
  banner: {
    js: '/* @lelemondev/sdk - LLM Observability */',
  },
});
