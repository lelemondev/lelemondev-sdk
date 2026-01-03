# @lelemondev/sdk

[![npm version](https://img.shields.io/npm/v/@lelemondev/sdk.svg)](https://www.npmjs.com/package/@lelemondev/sdk)
[![CI](https://github.com/lelemondev/lelemondev-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/lelemondev/lelemondev-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Automatic LLM observability for Node.js. Track your AI agents with zero code changes.

## Features

- **Automatic Tracing** - Wrap your client, everything is traced
- **Fire-and-forget** - Never blocks your code
- **Auto-batching** - Efficient network usage
- **Streaming Support** - Full support for streaming responses
- **Type-safe** - Preserves your client's TypeScript types
- **Serverless-ready** - Built-in flush for Lambda/Vercel

## Installation

```bash
npm install @lelemondev/sdk
```

## Quick Start

```typescript
import { init, observe, flush } from '@lelemondev/sdk';
import OpenAI from 'openai';

// 1. Initialize once at app startup
init({ apiKey: process.env.LELEMON_API_KEY });

// 2. Wrap your client
const openai = observe(new OpenAI());

// 3. Use normally - all calls are traced automatically
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
});

// 4. For serverless: flush before response
await flush();
```

That's it! No manual tracing code needed.

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
  apiKey: 'le_xxx',           // Required (or set LELEMON_API_KEY env var)
  endpoint: 'https://...',    // Optional, custom endpoint
  debug: false,               // Optional, enable debug logs
  disabled: false,            // Optional, disable all tracing
  batchSize: 10,              // Optional, items per batch
  flushIntervalMs: 1000,      // Optional, auto-flush interval
  requestTimeoutMs: 10000,    // Optional, HTTP request timeout
});
```

### `observe(client, options?)`

Wrap an LLM client with automatic tracing. Returns the same client type.

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = observe(new Anthropic(), {
  sessionId: 'session-123',   // Optional, group related traces
  userId: 'user-456',         // Optional, identify the user
  metadata: { source: 'api' }, // Optional, custom metadata
  tags: ['production'],       // Optional, tags for filtering
});
```

### `createObserve(defaultOptions)`

Create a scoped observe function with preset options.

```typescript
const observeWithSession = createObserve({
  sessionId: 'session-123',
  userId: 'user-456',
});

const openai = observeWithSession(new OpenAI());
const anthropic = observeWithSession(new Anthropic());
```

### `flush()`

Wait for all pending traces to be sent. Use in serverless environments.

```typescript
await flush();
```

### `isEnabled()`

Check if tracing is enabled.

```typescript
if (isEnabled()) {
  console.log('Tracing is active');
}
```

## Streaming Support

Both OpenAI and Anthropic streaming are fully supported:

```typescript
// OpenAI streaming
const stream = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
// Trace is captured automatically when stream completes

// Anthropic streaming
const stream = anthropic.messages.stream({
  model: 'claude-3-opus-20240229',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});

for await (const event of stream) {
  // Process events
}
// Trace is captured automatically
```

## Serverless Usage

### Vercel (Next.js)

```typescript
import { waitUntil } from '@vercel/functions';
import { init, observe, flush } from '@lelemondev/sdk';
import OpenAI from 'openai';

init({ apiKey: process.env.LELEMON_API_KEY });
const openai = observe(new OpenAI());

export async function POST(req: Request) {
  const { message } = await req.json();

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: message }],
  });

  waitUntil(flush());  // Flush after response
  return Response.json(response.choices[0].message);
}
```

### AWS Lambda

```typescript
import { init, observe, flush } from '@lelemondev/sdk';
import OpenAI from 'openai';

init({ apiKey: process.env.LELEMON_API_KEY });
const openai = observe(new OpenAI());

export const handler = async (event) => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: event.body }],
  });

  await flush();  // Always flush before Lambda ends
  return { statusCode: 200, body: JSON.stringify(response) };
};
```

## What Gets Traced

Each LLM call automatically captures:

- **Provider** - openai, anthropic
- **Model** - gpt-4, claude-3-opus, etc.
- **Input** - Messages/prompt (sanitized)
- **Output** - Response content
- **Tokens** - Input and output token counts
- **Duration** - Request latency in ms
- **Status** - success or error
- **Streaming** - Whether streaming was used

## Security

The SDK automatically sanitizes sensitive data:

- API keys and tokens are redacted
- Large payloads are truncated
- Errors are captured without stack traces

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LELEMON_API_KEY` | Your Lelemon API key (starts with `le_`) |

## License

MIT
