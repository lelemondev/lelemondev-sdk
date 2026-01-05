/**
 * Lelemon SDK
 * Automatic LLM observability
 *
 * @example Simple usage
 * ```typescript
 * import { init, observe, flush } from '@lelemondev/sdk';
 * import OpenAI from 'openai';
 *
 * init({ apiKey: process.env.LELEMON_API_KEY });
 * const openai = observe(new OpenAI());
 *
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 *
 * await flush(); // For serverless
 * ```
 *
 * @example With trace hierarchy (agents, RAG)
 * ```typescript
 * import { init, observe, trace, span, flush } from '@lelemondev/sdk';
 * import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
 *
 * init({ apiKey: process.env.LELEMON_API_KEY });
 * const client = observe(new BedrockRuntimeClient());
 *
 * // Group multiple LLM calls under a single trace
 * await trace('sales-agent', async () => {
 *   // LLM calls are automatically captured as child spans
 *   await client.send(new ConverseCommand({ modelId: 'anthropic.claude-3-haiku', ... }));
 *   await client.send(new ConverseCommand({ modelId: 'anthropic.claude-3-sonnet', ... }));
 *
 *   // Manual spans for non-LLM operations
 *   span({ type: 'retrieval', name: 'pinecone', output: { count: 5 } });
 * });
 *
 * await flush();
 * ```
 */

// ─────────────────────────────────────────────────────────────
// Main API
// ─────────────────────────────────────────────────────────────

// Configuration
export { init, flush, isEnabled } from './core/config';

// Observe (primary API)
export { observe, createObserve } from './observe';

// Trace hierarchy (Phase 7.2)
export { trace, span, getTraceContext } from './core/context';

// Manual span capture (lower-level API)
export { captureSpan } from './core/capture';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type {
  LelemonConfig,
  ObserveOptions,
  ProviderName,
  SpanType,
  CaptureSpanOptions,
} from './core/types';

export type { TraceOptions, SpanOptions } from './core/context';

