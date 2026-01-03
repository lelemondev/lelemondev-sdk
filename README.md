# @lelemondev/sdk

[![npm version](https://img.shields.io/npm/v/@lelemondev/sdk.svg)](https://www.npmjs.com/package/@lelemondev/sdk)
[![CI](https://github.com/lelemondev/lelemondev-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/lelemondev/lelemondev-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Automatic LLM observability for Node.js. Wrap your client, everything is traced.

## LLM Agent Docs

```
https://lelemondev.github.io/lelemondev-sdk/llms.txt
https://lelemondev.github.io/lelemondev-sdk/llms-full.txt
```

## Features

- **Automatic Tracing** - Wrap your client, all calls are traced
- **Zero Config** - Works out of the box
- **Framework Integrations** - Next.js, Express, Lambda, Hono
- **Streaming Support** - Full support for streaming responses
- **Type-safe** - Preserves your client's TypeScript types

## Installation

```bash
npm install @lelemondev/sdk
```

## Quick Start

```typescript
import { init, observe } from '@lelemondev/sdk';
import OpenAI from 'openai';

// 1. Initialize once
init({ apiKey: process.env.LELEMON_API_KEY });

// 2. Wrap your client
const openai = observe(new OpenAI());

// 3. Use normally - all calls traced automatically
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

## Framework Integrations

### Next.js App Router

```typescript
// app/api/chat/route.ts
import { init, observe } from '@lelemondev/sdk';
import { withObserve } from '@lelemondev/sdk/next';
import { after } from 'next/server';
import OpenAI from 'openai';

init({ apiKey: process.env.LELEMON_API_KEY });
const openai = observe(new OpenAI());

export const POST = withObserve(
  async (req) => {
    const { message } = await req.json();
    const result = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: message }],
    });
    return Response.json(result.choices[0].message);
  },
  { after } // Non-blocking flush (Next.js 15+)
);
```

### Express

```typescript
import express from 'express';
import { init, observe } from '@lelemondev/sdk';
import { createMiddleware } from '@lelemondev/sdk/express';
import OpenAI from 'openai';

init({ apiKey: process.env.LELEMON_API_KEY });
const openai = observe(new OpenAI());

const app = express();
app.use(createMiddleware()); // Auto-flush on response finish

app.post('/chat', async (req, res) => {
  const result = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: req.body.message }],
  });
  res.json(result.choices[0].message);
});
```

### AWS Lambda

```typescript
import { init, observe } from '@lelemondev/sdk';
import { withObserve } from '@lelemondev/sdk/lambda';
import OpenAI from 'openai';

init({ apiKey: process.env.LELEMON_API_KEY });
const openai = observe(new OpenAI());

export const handler = withObserve(async (event) => {
  const body = JSON.parse(event.body);
  const result = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: body.message }],
  });
  return {
    statusCode: 200,
    body: JSON.stringify(result.choices[0].message),
  };
});
```

### Hono (Cloudflare Workers, Deno, Bun)

```typescript
import { Hono } from 'hono';
import { init, observe } from '@lelemondev/sdk';
import { createMiddleware } from '@lelemondev/sdk/hono';
import OpenAI from 'openai';

init({ apiKey: process.env.LELEMON_API_KEY });
const openai = observe(new OpenAI());

const app = new Hono();
app.use(createMiddleware()); // Uses waitUntil on Workers

app.post('/chat', async (c) => {
  const { message } = await c.req.json();
  const result = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: message }],
  });
  return c.json(result.choices[0].message);
});

export default app;
```

## Supported Providers

| Provider | Status | Methods |
|----------|--------|---------|
| OpenAI | Supported | `chat.completions.create()`, `completions.create()`, `embeddings.create()` |
| Anthropic | Supported | `messages.create()`, `messages.stream()` |

## API Reference

### `init(config)`

Initialize the SDK. Call once at app startup.

```typescript
init({
  apiKey: 'le_xxx',           // Required (or LELEMON_API_KEY env var)
  endpoint: 'https://...',    // Optional, custom endpoint
  debug: false,               // Optional, enable debug logs
  disabled: false,            // Optional, disable tracing
  batchSize: 10,              // Optional, items per batch
  flushIntervalMs: 1000,      // Optional, auto-flush interval
});
```

### `observe(client, options?)`

Wrap an LLM client with automatic tracing.

```typescript
const openai = observe(new OpenAI(), {
  sessionId: 'session-123',
  userId: 'user-456',
  metadata: { source: 'api' },
  tags: ['production'],
});
```

### `flush()`

Manually flush pending traces. Use in serverless without framework integration.

```typescript
await flush();
```

## Streaming

Both OpenAI and Anthropic streaming are fully supported:

```typescript
const stream = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
// Trace captured automatically when stream completes
```

## What Gets Traced

Each LLM call automatically captures:

- **Provider** - openai, anthropic
- **Model** - gpt-4, claude-3-opus, etc.
- **Input** - Messages/prompt (sanitized)
- **Output** - Response content
- **Tokens** - Input and output counts
- **Duration** - Request latency in ms
- **Status** - success or error
- **Streaming** - Whether streaming was used

## Security

The SDK automatically sanitizes sensitive data:

- API keys and tokens are redacted
- Large payloads are truncated
- Errors are captured safely

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LELEMON_API_KEY` | Your API key (starts with `le_`) |

## License

MIT

## Sources

Framework integration patterns based on:
- [Next.js after() docs](https://nextjs.org/docs/app/api-reference/functions/after)
- [Vercel waitUntil](https://www.inngest.com/blog/vercel-cloudflare-wait-until)
- [Langfuse SDK patterns](https://langfuse.com/docs/observability/sdk/typescript/advanced-usage)
