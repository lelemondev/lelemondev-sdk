#!/usr/bin/env node
/**
 * Generate llms.txt and llms-full.txt for LLM-friendly documentation
 * Following the llms.txt standard: https://llmstxt.org/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DOCS_DIR = join(ROOT, 'docs');

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = PACKAGE.version;
const DOCS_BASE_URL = 'https://lelemondev.github.io/lelemondev-sdk';

// ─────────────────────────────────────────────────────────────
// Content Generation
// ─────────────────────────────────────────────────────────────

function generateLlmsTxt() {
  return `# @lelemondev/sdk

> Automatic LLM observability SDK for Node.js. Wrap your OpenAI or Anthropic client with \`observe()\`, and all calls are traced automatically. Zero config, type-safe, with built-in support for Next.js, Express, AWS Lambda, and Hono.

## Documentation

- [Full Documentation](${DOCS_BASE_URL}/llms-full.txt): Complete SDK documentation in a single file
- [API Reference](${DOCS_BASE_URL}): TypeDoc generated API reference
- [GitHub Repository](https://github.com/lelemondev/lelemondev-sdk): Source code and issues
- [npm Package](https://www.npmjs.com/package/@lelemondev/sdk): Package installation

## Quick Start

\`\`\`typescript
import { init, observe } from '@lelemondev/sdk';
import OpenAI from 'openai';

init({ apiKey: process.env.LELEMON_API_KEY });
const openai = observe(new OpenAI());

const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
});
\`\`\`

## Core Concepts

- **observe()**: Wraps LLM clients (OpenAI, Anthropic) with automatic tracing
- **init()**: Initialize SDK with API key and configuration
- **flush()**: Manually flush pending traces (required in serverless)
- **Framework integrations**: Auto-flush middleware for Next.js, Express, Lambda, Hono

## Version

Current version: ${VERSION}
`;
}

function generateLlmsFullTxt() {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf-8');

  // Read integration docs
  const integrations = {
    next: readFileSync(join(ROOT, 'src/integrations/next.ts'), 'utf-8'),
    lambda: readFileSync(join(ROOT, 'src/integrations/lambda.ts'), 'utf-8'),
    express: readFileSync(join(ROOT, 'src/integrations/express.ts'), 'utf-8'),
    hono: readFileSync(join(ROOT, 'src/integrations/hono.ts'), 'utf-8'),
  };

  // Extract JSDoc from integration files
  const extractJSDoc = (content) => {
    const match = content.match(/\/\*\*[\s\S]*?\*\//g);
    return match ? match.join('\n\n') : '';
  };

  return `# @lelemondev/sdk - Complete Documentation

> Automatic LLM observability SDK for Node.js. Version ${VERSION}.

This document contains the complete documentation for @lelemondev/sdk, optimized for LLM consumption.

---

${readme}

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

### observe(client, options?)

Wrap an LLM client with automatic tracing.

**Parameters:**
- \`client\`: OpenAI or Anthropic client instance
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

---

# Supported Providers

| Provider | Methods | Streaming |
|----------|---------|-----------|
| OpenAI | \`chat.completions.create()\`, \`completions.create()\`, \`embeddings.create()\` | Yes |
| Anthropic | \`messages.create()\`, \`messages.stream()\` | Yes |

---

# Traced Data

Each LLM call automatically captures:

- **provider**: openai, anthropic
- **model**: gpt-4, claude-3-opus, etc.
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
import { observe, type ObserveOptions, type LelemonConfig } from '@lelemondev/sdk';

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

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

function main() {
  // Ensure docs directory exists
  if (!existsSync(DOCS_DIR)) {
    mkdirSync(DOCS_DIR, { recursive: true });
  }

  // Generate files
  const llmsTxt = generateLlmsTxt();
  const llmsFullTxt = generateLlmsFullTxt();

  // Write files
  writeFileSync(join(DOCS_DIR, 'llms.txt'), llmsTxt);
  writeFileSync(join(DOCS_DIR, 'llms-full.txt'), llmsFullTxt);

  console.log('Generated:');
  console.log(`  - docs/llms.txt (${llmsTxt.length} bytes)`);
  console.log(`  - docs/llms-full.txt (${llmsFullTxt.length} bytes)`);
}

main();
