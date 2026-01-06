import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Core (no providers)
    index: 'src/index.ts',
    // Provider-specific (lightweight)
    openai: 'src/openai.ts',
    anthropic: 'src/anthropic.ts',
    bedrock: 'src/bedrock.ts',
    gemini: 'src/gemini.ts',
    openrouter: 'src/openrouter.ts',
    // Framework integrations
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
  minify: true,
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
