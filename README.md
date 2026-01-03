# @lelemondev/sdk

[![npm version](https://img.shields.io/npm/v/@lelemondev/sdk.svg)](https://www.npmjs.com/package/@lelemondev/sdk)
[![CI](https://github.com/lelemondev/lelemondev-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/lelemondev/lelemondev-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Fire-and-forget LLM observability for Node.js. Track your AI agents with 3 lines of code.

## Features

- 🔥 **Fire-and-forget** - Never blocks your code
- 📦 **Auto-batching** - Efficient network usage
- ⚡ **Zero config** - Works out of the box
- 🛡️ **Error-safe** - Never crashes your app
- 🌐 **Serverless-ready** - Built-in flush for Lambda/Vercel

## Installation

```bash
npm install @lelemondev/sdk
```

## Quick Start

```typescript
import { init, trace, flush } from '@lelemondev/sdk';

// Initialize once at app startup
init({ apiKey: process.env.LELEMON_API_KEY });

// Trace your agent (fire-and-forget, no awaits needed!)
const t = trace({ input: userMessage });

try {
  const result = await myAgent(userMessage);
  t.success(result.messages);  // Sync, doesn't block
} catch (error) {
  t.error(error);              // Sync, doesn't block
  throw error;
}

// For serverless: flush before response
await flush();
```

## API Reference

### `init(config)`

Initialize the SDK. Call once at app startup.

```typescript
init({
  apiKey: 'le_xxx',           // Required (or set LELEMON_API_KEY env var)
  endpoint: 'https://...',    // Optional, custom endpoint
  debug: false,               // Optional, enable debug logs
  batchSize: 10,              // Optional, items per batch
  flushIntervalMs: 1000,      // Optional, auto-flush interval
});
```

### `trace(options)`

Start a new trace. Returns a `Trace` object.

```typescript
const t = trace({
  input: userMessage,         // Required, the input to your agent
  sessionId: 'session-123',   // Optional, group related traces
  userId: 'user-456',         // Optional, identify the user
  name: 'chat-agent',         // Optional, name for this trace
  metadata: { ... },          // Optional, custom metadata
  tags: ['prod', 'v2'],       // Optional, tags for filtering
});
```

### `Trace.success(messages)`

Complete the trace successfully. Fire-and-forget (no await needed).

```typescript
t.success(result.messages);
```

### `Trace.error(error, messages?)`

Complete the trace with an error. Fire-and-forget (no await needed).

```typescript
t.error(error);
t.error(error, partialMessages);  // Include messages up to failure
```

### `Trace.log(response)`

Log an LLM response for token tracking (optional).

```typescript
const response = await openai.chat.completions.create(...);
t.log(response);  // Extracts model, tokens automatically
```

### `flush()`

Wait for all pending traces to be sent. Use in serverless environments.

```typescript
await flush();
```

## Serverless Usage

### Vercel (Next.js)

```typescript
import { waitUntil } from '@vercel/functions';
import { trace, flush } from '@lelemondev/sdk';

export async function POST(req: Request) {
  const t = trace({ input: message });

  try {
    const result = await myAgent(message);
    t.success(result);
    return Response.json(result);
  } catch (error) {
    t.error(error);
    throw error;
  } finally {
    waitUntil(flush());  // Flush after response
  }
}
```

### AWS Lambda

```typescript
import { trace, flush } from '@lelemondev/sdk';

export const handler = async (event) => {
  const t = trace({ input: event.body });

  try {
    const result = await myAgent(event.body);
    t.success(result);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    t.error(error);
    throw error;
  } finally {
    await flush();  // Always flush before Lambda ends
  }
};
```

## Supported Providers

| Provider | Auto-detected |
|----------|---------------|
| OpenAI | ✅ |
| Anthropic | ✅ |
| Google Gemini | ✅ |
| AWS Bedrock | ✅ |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LELEMON_API_KEY` | Your Lelemon API key (starts with `le_`) |

## License

MIT © [Lelemon](https://lelemon.dev)
