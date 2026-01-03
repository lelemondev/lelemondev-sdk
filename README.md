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
| OpenAI | ✅ | `chat.completions.create()`, `responses.create()`, `completions.create()`, `embeddings.create()` |
| Anthropic | ✅ | `messages.create()`, `messages.stream()` |
| AWS Bedrock | ✅ | `ConverseCommand`, `ConverseStreamCommand`, `InvokeModelCommand` |
| Google Gemini | ✅ | `generateContent()`, `generateContentStream()`, `chat.sendMessage()` |

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

## User & Session Tracking

Track which user generated each trace and group related conversations.

### Available Fields

| Field | Purpose | Example |
|-------|---------|---------|
| `userId` | Identify the end user | `'user-123'`, `req.user.id` |
| `sessionId` | Group related traces (e.g., a conversation) | `'conv-abc'`, `req.headers['x-session-id']` |
| `metadata` | Custom data for filtering/analysis | `{ plan: 'premium', version: '2.1' }` |
| `tags` | Labels for categorization | `['production', 'chat', 'premium']` |

### Basic Usage

```typescript
const openai = observe(new OpenAI(), {
  userId: 'user-123',
  sessionId: 'conversation-abc',
});
```

### In an API Endpoint

```typescript
// Express
app.post('/chat', async (req, res) => {
  // Create client with user context from the request
  const openai = observe(new OpenAI(), {
    userId: req.user.id,
    sessionId: req.headers['x-session-id'],
    metadata: {
      plan: req.user.plan,
      endpoint: '/chat'
    },
  });

  const result = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: req.body.message }],
  });

  res.json(result.choices[0].message);
});
```

### Reusable Context with createObserve()

When you have multiple LLM clients or make calls from different places, use `createObserve()` to avoid repeating context:

```typescript
import { createObserve } from '@lelemondev/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

// Create a scoped observe function with user context
const observeForUser = createObserve({
  userId: 'user-123',
  sessionId: 'session-456',
  tags: ['premium'],
});

// All clients inherit the same context
const openai = observeForUser(new OpenAI());
const gemini = observeForUser(new GoogleGenerativeAI(apiKey));
const bedrock = observeForUser(new BedrockRuntimeClient({}));

// All these calls will be associated with user-123
await openai.chat.completions.create({ ... });
await gemini.getGenerativeModel({ model: 'gemini-pro' }).generateContent('...');
```

### In Middleware (Express)

Set up user context once, use it everywhere:

```typescript
import { createObserve } from '@lelemondev/sdk';

// Middleware to attach observe function to request
app.use((req, res, next) => {
  req.observe = createObserve({
    userId: req.user?.id,
    sessionId: req.headers['x-session-id'] || crypto.randomUUID(),
    metadata: {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    },
  });
  next();
});

// In any route handler
app.post('/chat', async (req, res) => {
  const openai = req.observe(new OpenAI());
  // Calls are automatically associated with the user
});

app.post('/summarize', async (req, res) => {
  const gemini = req.observe(new GoogleGenerativeAI(apiKey));
  // Same user context, different endpoint
});
```

### Multi-tenant Application

```typescript
app.post('/api/:tenantId/chat', async (req, res) => {
  const openai = observe(new OpenAI(), {
    userId: req.user.id,
    sessionId: req.body.conversationId,
    metadata: {
      tenantId: req.params.tenantId,
      environment: process.env.NODE_ENV,
    },
    tags: [req.params.tenantId, req.user.plan],
  });

  // Traces can be filtered by tenant, user, or conversation
});
```

### Distributed Systems (API + WebSocket)

When your application spans multiple services (REST API, WebSocket server, background workers), use consistent identifiers across all of them:

```typescript
// Shared utility for creating observe context
// utils/observe-context.ts
import { createObserve } from '@lelemondev/sdk';

export function createUserObserve(userId: string, sessionId: string, service: string) {
  return createObserve({
    userId,
    sessionId,
    metadata: { service },
    tags: [service],
  });
}
```

**REST API Server:**

```typescript
// api-server.ts
import { createUserObserve } from './utils/observe-context';

app.post('/chat/start', async (req, res) => {
  const { userId, sessionId } = req.body;

  const observe = createUserObserve(userId, sessionId, 'api');
  const openai = observe(new OpenAI());

  const result = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: req.body.message }],
  });

  res.json({
    response: result.choices[0].message,
    sessionId, // Return sessionId for client to use in WebSocket
  });
});
```

**WebSocket Server:**

```typescript
// ws-server.ts
import { createUserObserve } from './utils/observe-context';

wss.on('connection', (ws, req) => {
  // Get userId and sessionId from connection (query params, auth token, etc.)
  const userId = getUserFromToken(req);
  const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId');

  // Create observe function for this connection
  const observe = createUserObserve(userId, sessionId, 'websocket');
  const gemini = observe(new GoogleGenerativeAI(apiKey));

  ws.on('message', async (data) => {
    const { message } = JSON.parse(data);

    // This trace will be linked to the same session as the API calls
    const model = gemini.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent(message);

    ws.send(JSON.stringify({ response: result.response.text() }));
  });
});
```

**Background Worker / Queue Consumer:**

```typescript
// worker.ts
import { createUserObserve } from './utils/observe-context';

queue.process('ai-task', async (job) => {
  const { userId, sessionId, prompt } = job.data;

  const observe = createUserObserve(userId, sessionId, 'worker');
  const bedrock = observe(new BedrockRuntimeClient({}));

  const command = new ConverseCommand({
    modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
    messages: [{ role: 'user', content: [{ text: prompt }] }],
  });

  const result = await bedrock.send(command);
  return result.output.message.content[0].text;
});
```

**Client-side (passing sessionId between services):**

```typescript
// Frontend - maintains sessionId across API and WebSocket
const sessionId = crypto.randomUUID(); // Or from your session management

// REST API call
const response = await fetch('/chat/start', {
  method: 'POST',
  body: JSON.stringify({ userId, sessionId, message: 'Hello' }),
});

// WebSocket connection with same sessionId
const ws = new WebSocket(`wss://your-app.com/ws?sessionId=${sessionId}`);

// Both API and WebSocket traces will be grouped under the same session
```

**Viewing in Dashboard:**

With consistent `userId` and `sessionId` across services, you can:
- See a user's complete journey across API → WebSocket → Background jobs
- Filter by service (`metadata.service`) to isolate issues
- Track a conversation that spans multiple services

### What This Enables

With proper user/session tracking you can:

- **Filter traces by user** - See all LLM calls from a specific user
- **View full conversations** - Group all calls in a session together
- **Debug issues** - Find exactly what happened for a specific user request
- **Analyze usage patterns** - Understand how different user segments use your AI features
- **Cost attribution** - Track token usage per user, tenant, or feature

## Streaming

All providers support streaming:

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

- **Provider** - openai, anthropic, bedrock, gemini
- **Model** - gpt-4, claude-3-opus, gemini-pro, etc.
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
