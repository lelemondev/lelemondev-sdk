#!/usr/bin/env node
/**
 * Generate llms.txt and llms-full.txt for LLM-friendly documentation
 * Following the llms.txt standard: https://llmstxt.org/
 *
 * Auto-discovers providers from src/providers/*.ts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DOCS_DIR = join(ROOT, 'docs');
const PROVIDERS_DIR = join(ROOT, 'src', 'providers');

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = PACKAGE.version;
const DOCS_BASE_URL = 'https://lelemondev.github.io/lelemondev-sdk';

// Files to skip when scanning providers
const SKIP_FILES = ['base.ts', 'index.ts'];

// ─────────────────────────────────────────────────────────────
// Provider Discovery
// ─────────────────────────────────────────────────────────────

/**
 * Discover all providers from src/providers/*.ts
 */
function discoverProviders() {
  const providerFiles = readdirSync(PROVIDERS_DIR)
    .filter(f => f.endsWith('.ts') && !SKIP_FILES.includes(f));

  const providers = [];

  for (const file of providerFiles) {
    const content = readFileSync(join(PROVIDERS_DIR, file), 'utf-8');
    const provider = parseProvider(content, file);
    if (provider) {
      providers.push(provider);
    }
  }

  return providers.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Parse a provider file to extract metadata
 */
function parseProvider(content, filename) {
  // Extract PROVIDER_NAME
  const nameMatch = content.match(/export const PROVIDER_NAME[^=]*=\s*['"]([^'"]+)['"]/);
  if (!nameMatch) return null;

  const name = nameMatch[1];

  // Extract JSDoc header (first block comment)
  const jsdocMatch = content.match(/^\/\*\*[\s\S]*?\*\//);
  const jsdoc = jsdocMatch ? jsdocMatch[0] : '';

  // Extract methods from JSDoc (lines starting with " * - ")
  const methods = [];
  const methodMatches = jsdoc.matchAll(/\*\s+-\s+([^\n]+)/g);
  for (const match of methodMatches) {
    methods.push(match[1].trim());
  }

  // Check for streaming support
  const hasStreaming = content.includes('streaming: true') ||
    content.includes('wrapStream') ||
    content.includes('AsyncIterable');

  // Extract description from JSDoc (first line after /*)
  const descMatch = jsdoc.match(/\/\*\*\s*\n\s*\*\s*([^\n]+)/);
  const description = descMatch ? descMatch[1].trim() : `${capitalize(name)} Provider`;

  return {
    name,
    filename: basename(filename, '.ts'),
    description,
    methods,
    streaming: hasStreaming,
  };
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─────────────────────────────────────────────────────────────
// Content Generation
// ─────────────────────────────────────────────────────────────

function generateLlmsTxt(providers) {
  const providerList = providers.map(p => capitalize(p.name)).join(', ');

  return `# @lelemondev/sdk

> Automatic LLM observability SDK for Node.js. Wrap your ${providerList} client with \`observe()\`, and all calls are traced automatically. Zero config, type-safe, with built-in support for Next.js, Express, AWS Lambda, and Hono.

## Documentation

- [Full Documentation](${DOCS_BASE_URL}/llms-full.txt): Complete SDK documentation in a single file
- [API Reference](${DOCS_BASE_URL}): TypeDoc generated API reference
- [GitHub Repository](https://github.com/lelemondev/lelemondev-sdk): Source code and issues
- [npm Package](https://www.npmjs.com/package/@lelemondev/sdk): Package installation

## Quick Start

\`\`\`typescript
// Import from provider-specific entry point for smaller bundle size
import { init, observe } from '@lelemondev/sdk/openai';
import OpenAI from 'openai';

init({ apiKey: process.env.LELEMON_API_KEY });
const openai = observe(new OpenAI());

const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
});
\`\`\`

## Provider-Specific Imports

Each provider has its own entry point for optimal bundle size:

${providers.map(p => `- \`@lelemondev/sdk/${p.filename}\` - ${capitalize(p.name)}`).join('\n')}

## Supported Providers

${providers.map(p => `- **${capitalize(p.name)}**: ${p.methods.join(', ') || 'All methods'}${p.streaming ? ' (streaming supported)' : ''}`).join('\n')}

## Core Concepts

- **observe()**: Wraps LLM clients (${providerList}) with automatic tracing
- **init()**: Initialize SDK with API key and configuration
- **trace()**: Group multiple LLM calls under a single trace (for agents, RAG)
- **span()**: Manually capture non-LLM operations (retrieval, embedding, tool calls)
- **captureSpan()**: Lower-level API for manual span capture
- **getTraceContext()**: Get current trace context
- **flush()**: Manually flush pending traces (required in serverless)
- **isEnabled()**: Check if tracing is enabled
- **createObserve()**: Create a scoped observe function with preset context (import from \`@lelemondev/sdk\`)
- **Framework integrations**: Auto-flush middleware for Next.js, Express, Lambda, Hono

## Version

Current version: ${VERSION}
`;
}

function generateLlmsFullTxt(providers) {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');
  const providerList = providers.map(p => capitalize(p.name)).join(', ');

  // Read integration docs
  const integrations = {
    next: safeReadFile(join(ROOT, 'src/integrations/next.ts')),
    lambda: safeReadFile(join(ROOT, 'src/integrations/lambda.ts')),
    express: safeReadFile(join(ROOT, 'src/integrations/express.ts')),
    hono: safeReadFile(join(ROOT, 'src/integrations/hono.ts')),
  };

  // Generate provider table
  const providerTable = generateProviderTable(providers);

  return `# @lelemondev/sdk - Complete Documentation

> Automatic LLM observability SDK for Node.js. Version ${VERSION}.

This document contains the complete documentation for @lelemondev/sdk, optimized for LLM consumption.

---

${readme}

---

# Supported Providers

${providerTable}

${providers.map(p => generateProviderSection(p)).join('\n\n')}

---

# Framework Integration Details

## Next.js Integration (@lelemondev/sdk/next)

The Next.js integration provides automatic trace flushing for App Router handlers.

### Exported Functions

- \`withObserve(handler, options?)\`: Wrap a route handler with auto-flush
- \`createWrapper(defaultOptions)\`: Create a pre-configured wrapper

### Options

- \`after\`: Next.js 15+ after() function for non-blocking flush (recommended)
- \`waitUntil\`: Vercel's waitUntil() for non-blocking flush

### Usage Patterns

\`\`\`typescript
// Basic (blocking flush)
export const POST = withObserve(async (req) => {
  return Response.json({ ok: true });
});

// Next.js 15+ with after() - non-blocking (recommended)
import { after } from 'next/server';
export const POST = withObserve(handler, { after });

// Vercel with waitUntil()
import { waitUntil } from '@vercel/functions';
export const POST = withObserve(handler, { waitUntil });
\`\`\`

---

## AWS Lambda Integration (@lelemondev/sdk/lambda)

The Lambda integration ensures traces are flushed before the container freezes.

### Exported Functions

- \`withObserve(handler)\`: Wrap a Lambda handler with auto-flush

### Exported Types

- \`LambdaHandler<TEvent, TResult>\`: Generic Lambda handler type
- \`LambdaContext\`: AWS Lambda context object

### Usage

\`\`\`typescript
import { withObserve } from '@lelemondev/sdk/lambda';

export const handler = withObserve(async (event, context) => {
  // Your handler code
  return { statusCode: 200, body: 'OK' };
});
\`\`\`

---

## Express Integration (@lelemondev/sdk/express)

The Express integration provides middleware that flushes traces when the response finishes.

### Exported Functions

- \`createMiddleware()\`: Create Express middleware for auto-flush

### Exported Types

- \`ExpressMiddleware\`: Express middleware function type
- \`ExpressRequest\`: Minimal Express request type
- \`ExpressResponse\`: Minimal Express response type

### Usage

\`\`\`typescript
import express from 'express';
import { createMiddleware } from '@lelemondev/sdk/express';

const app = express();
app.use(createMiddleware()); // Global middleware

// Or per-route
app.post('/chat', createMiddleware(), handler);
\`\`\`

---

## Hono Integration (@lelemondev/sdk/hono)

The Hono integration works across all Hono runtimes (Cloudflare Workers, Deno, Bun, Node.js).

### Exported Functions

- \`createMiddleware()\`: Create Hono middleware for auto-flush

### Exported Types

- \`HonoMiddleware\`: Hono middleware function type
- \`HonoContext\`: Minimal Hono context type
- \`ExecutionContext\`: Edge runtime execution context

### Runtime Behavior

- **Cloudflare Workers / Deno Deploy**: Uses \`executionCtx.waitUntil()\` for non-blocking flush
- **Node.js / Bun**: Fire-and-forget flush after response

### Usage

\`\`\`typescript
import { Hono } from 'hono';
import { createMiddleware } from '@lelemondev/sdk/hono';

const app = new Hono();
app.use(createMiddleware());

export default app;
\`\`\`

---

# API Reference

## Core Functions

### init(config)

Initialize the SDK. Must be called once before using observe().

**Parameters:**
- \`apiKey\` (string, required): Your Lelemon API key (starts with \`le_\`)
- \`endpoint\` (string, optional): Custom API endpoint
- \`debug\` (boolean, optional): Enable debug logging
- \`disabled\` (boolean, optional): Disable all tracing
- \`batchSize\` (number, optional): Items per batch (default: 10)
- \`flushIntervalMs\` (number, optional): Auto-flush interval in ms (default: 1000)
- \`requestTimeoutMs\` (number, optional): HTTP request timeout in ms (default: 10000)
- \`service\` (object, optional): Service metadata for telemetry
  - \`name\`: Service name (e.g., 'my-ai-app')
  - \`version\`: Service version (e.g., '1.0.0')
  - \`environment\`: Deployment environment (e.g., 'production')

### observe(client, options?)

Wrap an LLM client with automatic tracing.

**Parameters:**
- \`client\`: ${providerList} client instance
- \`options\` (optional):
  - \`sessionId\`: Group traces by session
  - \`userId\`: Associate traces with a user
  - \`metadata\`: Custom key-value metadata
  - \`tags\`: Array of string tags

**Returns:** The same client type, fully typed

### flush()

Manually flush all pending traces. Required in serverless environments without framework integration.

**Returns:** Promise<void>

### isEnabled()

Check if tracing is enabled.

**Returns:** boolean

### trace(nameOrOptions, fn)

Group multiple LLM calls under a single trace. Useful for agents, RAG pipelines, and multi-step workflows.

**Parameters:**
- \`nameOrOptions\`: String name or options object with:
  - \`name\` (string, required): Trace name (e.g., 'sales-agent', 'rag-query')
  - \`input\` (unknown, optional): Input data for the trace
  - \`metadata\` (object, optional): Custom metadata
  - \`tags\` (string[], optional): Tags for filtering
- \`fn\`: Async function to execute within the trace context

**Returns:** Promise<T> - The result of the function

**Example:**
\`\`\`typescript
await trace('sales-agent', async () => {
  await client.send(new ConverseCommand({...})); // Automatically a child span
  await client.send(new ConverseCommand({...})); // Automatically a child span
});
\`\`\`

### span(options)

Manually capture a span for non-LLM operations. Must be called within a trace() block.

**Parameters:**
- \`type\`: 'retrieval' | 'embedding' | 'tool' | 'guardrail' | 'rerank' | 'custom'
- \`name\` (string, required): Span name (e.g., 'pinecone-search')
- \`input\` (unknown, optional): Input data
- \`output\` (unknown, optional): Output data
- \`durationMs\` (number, optional): Duration in milliseconds
- \`status\` ('success' | 'error', optional): Span status
- \`errorMessage\` (string, optional): Error message if status is 'error'
- \`metadata\` (object, optional): Custom metadata

**Returns:** void

**Example:**
\`\`\`typescript
await trace('rag-query', async () => {
  const t0 = Date.now();
  const docs = await pinecone.query({ vector, topK: 5 });
  span({
    type: 'retrieval',
    name: 'pinecone-search',
    input: { topK: 5 },
    output: { count: docs.length },
    durationMs: Date.now() - t0,
  });
  return client.send(new ConverseCommand({...}));
});
\`\`\`

### captureSpan(options)

Lower-level API for manual span capture. Works both inside and outside trace() blocks.

**Parameters:**
- \`type\`: 'retrieval' | 'embedding' | 'tool' | 'guardrail' | 'rerank' | 'custom'
- \`name\` (string, required): Span name
- \`input\` (unknown, required): Input data
- \`output\` (unknown, required): Output data
- \`durationMs\` (number, required): Duration in milliseconds
- \`status\` ('success' | 'error', optional): Span status (default: 'success')
- \`errorMessage\` (string, optional): Error message if status is 'error'
- \`toolCallId\` (string, optional): Tool call ID for linking to parent LLM
- \`metadata\` (object, optional): Custom metadata

**Returns:** void

### getTraceContext()

Get the current trace context (useful for advanced scenarios).

**Returns:** TraceContext | undefined

### createObserve(defaultOptions)

Create a scoped observe function with preset context. Import from \`@lelemondev/sdk\` (not provider-specific).

**Parameters:**
- \`defaultOptions\`: ObserveOptions to apply to all observe calls
  - \`sessionId\`: Group traces by session
  - \`userId\`: Associate traces with a user
  - \`metadata\`: Custom key-value metadata
  - \`tags\`: Array of string tags

**Returns:** A scoped observe function

**Example:**
\`\`\`typescript
import { init, createObserve } from '@lelemondev/sdk';

init({ apiKey: process.env.LELEMON_API_KEY });

const observeForUser = createObserve({
  userId: 'user-123',
  sessionId: 'session-456',
});

const openai = observeForUser(new OpenAI());
const anthropic = observeForUser(new Anthropic());
\`\`\`

---

# Traced Data

Each LLM call automatically captures:

- **provider**: ${providers.map(p => p.name).join(', ')}
- **model**: gpt-4, claude-3-opus, gemini-pro, etc.
- **input**: Messages/prompt
- **output**: Response content
- **inputTokens**: Token count for input
- **outputTokens**: Token count for output
- **durationMs**: Request latency
- **status**: success or error
- **streaming**: Whether streaming was used
- **sessionId**: Optional session identifier
- **userId**: Optional user identifier
- **metadata**: Custom metadata
- **tags**: Custom tags

---

# Environment Variables

| Variable | Description |
|----------|-------------|
| \`LELEMON_API_KEY\` | Your API key (alternative to init config) |

---

# TypeScript Support

The SDK is fully typed and preserves your client's original types:

\`\`\`typescript
import { observe, type ObserveOptions, type LelemonConfig } from '@lelemondev/sdk/openai';

// Client type is preserved
const openai = observe(new OpenAI()); // type: OpenAI

// Options are typed
const options: ObserveOptions = {
  sessionId: 'session-123',
  userId: 'user-456',
};
\`\`\`

---

# Error Handling

The SDK is designed to never break your application:

- Tracing errors are caught and logged (in debug mode)
- If tracing fails, your LLM calls still work normally
- Network errors during flush are silently ignored

---

# Security

- API keys in requests are automatically redacted
- Large payloads are truncated to prevent memory issues
- Sensitive headers are not captured

---

Generated for version ${VERSION}
`;
}

function generateProviderTable(providers) {
  const rows = providers.map(p => {
    const methods = p.methods.length > 0 ? p.methods.map(m => `\`${m}\``).join(', ') : 'All traced methods';
    const streaming = p.streaming ? 'Yes' : 'No';
    return `| ${capitalize(p.name)} | ${methods} | ${streaming} |`;
  });

  return `| Provider | Methods | Streaming |
|----------|---------|-----------|
${rows.join('\n')}`;
}

function generateProviderSection(provider) {
  return `## ${capitalize(provider.name)} Provider

${provider.description}

**Traced methods:**
${provider.methods.length > 0 ? provider.methods.map(m => `- \`${m}\``).join('\n') : '- All available methods'}

**Streaming support:** ${provider.streaming ? 'Yes' : 'No'}`;
}

function safeReadFile(path) {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

function main() {
  // Ensure docs directory exists
  if (!existsSync(DOCS_DIR)) {
    mkdirSync(DOCS_DIR, { recursive: true });
  }

  // Discover providers
  const providers = discoverProviders();
  console.log(`Discovered ${providers.length} providers: ${providers.map(p => p.name).join(', ')}`);

  // Generate files
  const llmsTxt = generateLlmsTxt(providers);
  const llmsFullTxt = generateLlmsFullTxt(providers);

  // Write files
  writeFileSync(join(DOCS_DIR, 'llms.txt'), llmsTxt);
  writeFileSync(join(DOCS_DIR, 'llms-full.txt'), llmsFullTxt);

  console.log('Generated:');
  console.log(`  - docs/llms.txt (${llmsTxt.length} bytes)`);
  console.log(`  - docs/llms-full.txt (${llmsFullTxt.length} bytes)`);
}

main();
