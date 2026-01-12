/**
 * Trace Context Module
 *
 * Provides AsyncLocalStorage-based context for grouping spans under a parent trace.
 * Supports hierarchical tracing where:
 * - trace() creates a root "agent" span
 * - LLM calls become children of the root
 * - Tool calls become children of the LLM that triggered them (via toolCallId linking)
 *
 * @example
 * ```typescript
 * import { trace, span } from '@lelemondev/sdk';
 *
 * await trace({ name: 'sales-agent', input: userMessage }, async () => {
 *   const response = await client.send(new ConverseCommand({...}));
 *   // Tools automatically linked to their parent LLM via toolCallId
 *   return response;
 * });
 * ```
 */

import { AsyncLocalStorage } from 'async_hooks';
import { getTransport } from './config';
import { getGlobalContext } from './capture';
import { debug } from './logger';
import type { CreateTraceRequest, SpanType } from './types';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface TraceContext {
  /** Unique trace ID (shared by all spans in this trace) */
  traceId: string;
  /** Root span ID (the agent/workflow span) */
  rootSpanId: string;
  /** Current span ID (for nesting - LLM calls become children of this) */
  currentSpanId: string;
  /** Parent span ID (for nested trace() calls) */
  parentSpanId?: string;
  /** Trace name */
  name: string;
  /** Start time in ms */
  startTime: number;
  /** Input data */
  input?: unknown;
  /** Trace metadata */
  metadata?: Record<string, unknown>;
  /** Trace tags */
  tags?: string[];
  /** Output extraction config */
  outputKey?: string | false;
  /** Output transform function */
  outputTransform?: (result: unknown) => unknown;
  /** Map of toolCallId → llmSpanId for linking tool spans to their parent LLM */
  pendingToolCalls: Map<string, string>;
}

export interface TraceOptions {
  /** Name for the trace (e.g., 'sales-agent', 'rag-query') */
  name: string;
  /** Input data for the trace */
  input?: unknown;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Tags for filtering */
  tags?: string[];
  /**
   * Key to extract from result object for cleaner output display.
   * If not specified, auto-detection tries: text, content, message, output, response, result, answer.
   * Set to `false` to disable auto-extraction and show raw result.
   *
   * @example
   * // Auto-extract 'text' field
   * trace({ name: 'agent' }, async () => ({ text: 'hello', tokens: 100 }));
   * // Output: "hello"
   *
   * @example
   * // Explicit key
   * trace({ name: 'agent', outputKey: 'response' }, async () => ({ response: 'hello' }));
   *
   * @example
   * // Disable auto-extraction
   * trace({ name: 'agent', outputKey: false }, async () => ({ a: 1, b: 2 }));
   * // Output: { a: 1, b: 2 }
   */
  outputKey?: string | false;
  /**
   * Transform function for custom output formatting.
   * Takes precedence over outputKey.
   *
   * @example
   * trace({
   *   name: 'agent',
   *   outputTransform: (r) => `Response: ${r.text} (${r.tokens} tokens)`
   * }, async () => ({ text: 'hello', tokens: 100 }));
   * // Output: "Response: hello (100 tokens)"
   */
  outputTransform?: (result: unknown) => unknown;
}

export interface SpanOptions {
  /** Span type */
  type: 'retrieval' | 'embedding' | 'tool' | 'guardrail' | 'rerank' | 'custom';
  /** Span name (e.g., 'pinecone-search', 'cohere-rerank') */
  name: string;
  /** Input data */
  input?: unknown;
  /** Output data */
  output?: unknown;
  /** Duration in milliseconds (optional, will be set automatically if not provided) */
  durationMs?: number;
  /** Status */
  status?: 'success' | 'error';
  /** Error message if status is 'error' */
  errorMessage?: string;
  /** Tool call ID (links this tool span to the LLM that requested it) */
  toolCallId?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// AsyncLocalStorage for trace context
// ─────────────────────────────────────────────────────────────

// Use a global symbol to ensure single instance across all entry points
// This fixes the issue where @lelemondev/sdk and @lelemondev/sdk/bedrock
// would create separate AsyncLocalStorage instances due to bundler splitting
const TRACE_STORAGE_KEY = Symbol.for('@lelemondev/sdk:traceStorage');

function getTraceStorage(): AsyncLocalStorage<TraceContext> {
  const globalObj = globalThis as Record<symbol, AsyncLocalStorage<TraceContext> | undefined>;
  if (!globalObj[TRACE_STORAGE_KEY]) {
    globalObj[TRACE_STORAGE_KEY] = new AsyncLocalStorage<TraceContext>();
  }
  return globalObj[TRACE_STORAGE_KEY];
}

const traceStorage = getTraceStorage();

// ─────────────────────────────────────────────────────────────
// ID Generation
// ─────────────────────────────────────────────────────────────

/**
 * Generate a unique trace/span ID
 * Uses crypto.randomUUID if available, falls back to timestamp-based ID
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older Node.js versions
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

// ─────────────────────────────────────────────────────────────
// Context API
// ─────────────────────────────────────────────────────────────

/**
 * Get the current trace context, if any
 */
export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

/**
 * Check if we're inside a trace() block
 */
export function hasTraceContext(): boolean {
  return traceStorage.getStore() !== undefined;
}

// ─────────────────────────────────────────────────────────────
// Tool Call Linking
// ─────────────────────────────────────────────────────────────

/**
 * Register tool calls from an LLM response.
 * When the LLM returns with tool_use, call this to link subsequent tool spans.
 * @param toolCallIds - Array of tool call IDs from the LLM response
 * @param llmSpanId - The span ID of the LLM call that requested these tools
 */
export function registerToolCalls(toolCallIds: string[], llmSpanId: string): void {
  const ctx = getTraceContext();
  if (!ctx) return;

  for (const id of toolCallIds) {
    ctx.pendingToolCalls.set(id, llmSpanId);
    debug(`Registered tool call ${id} → LLM span ${llmSpanId}`);
  }
}

/**
 * Get the correct parent span ID for a tool span.
 * If toolCallId matches a pending tool call, returns the LLM span that requested it.
 * Otherwise falls back to the current span ID.
 */
export function getToolParentSpanId(toolCallId?: string): string | undefined {
  const ctx = getTraceContext();
  if (!ctx) return undefined;

  if (toolCallId && ctx.pendingToolCalls.has(toolCallId)) {
    return ctx.pendingToolCalls.get(toolCallId);
  }

  return ctx.currentSpanId;
}

/**
 * Clear a tool call from the pending map after it's been processed.
 */
export function clearToolCall(toolCallId: string): void {
  const ctx = getTraceContext();
  if (ctx) {
    ctx.pendingToolCalls.delete(toolCallId);
  }
}

// ─────────────────────────────────────────────────────────────
// trace() - Main API for grouping spans
// ─────────────────────────────────────────────────────────────

/**
 * Execute a function within a trace context.
 * Creates a root "agent" span that contains all LLM calls and tool executions.
 *
 * **Output Auto-Extraction:** If the function returns an object with common text fields
 * (`text`, `content`, `message`, `output`, `response`, `result`, `answer`),
 * the SDK automatically extracts that field for cleaner display.
 * Use `outputKey` to specify a custom field, or `outputKey: false` to disable.
 *
 * @example Simple usage
 * ```typescript
 * await trace('sales-agent', async () => {
 *   return { text: 'Hello!', tokens: 100 };
 *   // Output shown: "Hello!" (auto-extracted from 'text')
 * });
 * ```
 *
 * @example With options and explicit outputKey
 * ```typescript
 * await trace({ name: 'agent', outputKey: 'reply' }, async () => {
 *   return { reply: 'Hello!', cost: 0.01 };
 *   // Output shown: "Hello!"
 * });
 * ```
 *
 * @example Disable auto-extraction
 * ```typescript
 * await trace({ name: 'agent', outputKey: false }, async () => {
 *   return { a: 1, b: 2 };
 *   // Output shown: { a: 1, b: 2 }
 * });
 * ```
 */
export async function trace<T>(
  nameOrOptions: string | TraceOptions,
  fn: () => Promise<T>
): Promise<T> {
  // Normalize options
  const options: TraceOptions =
    typeof nameOrOptions === 'string' ? { name: nameOrOptions } : nameOrOptions;

  const parentContext = getTraceContext();
  const traceId = parentContext?.traceId ?? generateId();
  const rootSpanId = generateId();

  const context: TraceContext = {
    traceId,
    rootSpanId,
    currentSpanId: rootSpanId,
    parentSpanId: parentContext?.currentSpanId,
    name: options.name,
    startTime: Date.now(),
    input: options.input,
    metadata: options.metadata,
    tags: options.tags,
    outputKey: options.outputKey,
    outputTransform: options.outputTransform,
    pendingToolCalls: new Map(),
  };

  // Run the function within the trace context
  return traceStorage.run(context, async () => {
    let result: T | undefined;
    let error: Error | undefined;

    try {
      result = await fn();
      return result;
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
      throw e;
    } finally {
      // Send the root span with the final result
      sendRootSpan(context, error ? undefined : result, error);
    }
  });
}

/** Common field names for auto-extracting text output (in priority order) */
const OUTPUT_TEXT_FIELDS = ['text', 'content', 'message', 'output', 'response', 'result', 'answer'];

/**
 * Extract display-friendly output from a result object.
 *
 * Priority:
 * 1. outputTransform function (if provided)
 * 2. Explicit outputKey (if provided)
 * 3. Auto-detection of common text fields
 * 4. Raw result (if outputKey === false or no text field found)
 *
 * @internal
 */
function extractOutput(
  result: unknown,
  outputKey?: string | false,
  outputTransform?: (r: unknown) => unknown,
): unknown {
  // 1. Custom transform takes precedence
  if (outputTransform) {
    try {
      return outputTransform(result);
    } catch {
      return result; // Fallback on transform error
    }
  }

  // 2. Explicit key or disabled
  if (outputKey === false) return result;
  if (typeof outputKey === 'string' && result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    return outputKey in obj ? obj[outputKey] : result;
  }

  // 3. Auto-detect common text fields
  if (result === null || result === undefined) return result;
  if (typeof result !== 'object' || Array.isArray(result)) return result;

  const obj = result as Record<string, unknown>;
  for (const field of OUTPUT_TEXT_FIELDS) {
    if (field in obj && typeof obj[field] === 'string') {
      return obj[field];
    }
  }

  // 4. No text field found, return as-is
  return result;
}

/**
 * Send the root "agent" span when the trace completes.
 * This span represents the entire agent execution with input/output.
 */
function sendRootSpan(context: TraceContext, result?: unknown, error?: Error): void {
  const transport = getTransport();
  if (!transport.isEnabled()) {
    debug('Transport disabled, skipping root span');
    return;
  }

  const globalContext = getGlobalContext();
  const durationMs = Date.now() - context.startTime;

  // Extract clean output for display
  const output = error ? null : extractOutput(result, context.outputKey, context.outputTransform);

  const rootSpan: CreateTraceRequest = {
    spanType: 'agent' as SpanType,
    name: context.name,
    provider: 'agent',
    model: context.name,
    traceId: context.traceId,
    spanId: context.rootSpanId,
    parentSpanId: context.parentSpanId,
    input: context.input,
    output,
    inputTokens: 0,  // Will be aggregated from children
    outputTokens: 0,
    durationMs,
    status: error ? 'error' : 'success',
    errorMessage: error?.message,
    streaming: false,
    sessionId: globalContext.sessionId,
    userId: globalContext.userId,
    metadata: {
      ...globalContext.metadata,
      ...context.metadata,
    },
    tags: context.tags ?? globalContext.tags,
  };

  debug(`Sending root span: ${context.name}`, { durationMs, hasError: !!error });
  transport.enqueue(rootSpan);
}

// ─────────────────────────────────────────────────────────────
// span() - Manual span capture for non-LLM operations
// ─────────────────────────────────────────────────────────────

// Import directly - circular dependency is handled by module system
import { captureSpan as captureSpanImport } from './capture';

/**
 * Manually capture a span for non-LLM operations (retrieval, embedding, tool, etc.)
 * Must be called within a trace() block.
 *
 * @example Tool with toolCallId (links to parent LLM)
 * ```typescript
 * span({
 *   type: 'tool',
 *   name: 'query_database',
 *   toolCallId: 'tooluse_abc123',  // Links to LLM that requested this
 *   input: { sql: 'SELECT ...' },
 *   output: { rows: [...] },
 *   durationMs: 15,
 * });
 * ```
 *
 * @example Retrieval without toolCallId
 * ```typescript
 * span({
 *   type: 'retrieval',
 *   name: 'pinecone-search',
 *   input: { topK: 5 },
 *   output: { count: 10 },
 *   durationMs: 50,
 * });
 * ```
 */
export function span(options: SpanOptions): void {
  const context = getTraceContext();

  if (!context) {
    // Warn but don't throw - fire-and-forget principle
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Lelemon] span() called outside of trace() - span will not be captured');
    }
    return;
  }

  // Determine parent: if toolCallId provided and registered, use the LLM span
  const parentSpanId = getToolParentSpanId(options.toolCallId);

  captureSpanImport({
    type: options.type,
    name: options.name,
    input: options.input,
    output: options.output,
    durationMs: options.durationMs ?? 0,
    status: options.status ?? 'success',
    errorMessage: options.errorMessage,
    toolCallId: options.toolCallId,
    metadata: {
      ...options.metadata,
      _traceId: context.traceId,
      _parentSpanId: parentSpanId,
    },
  });

  // Clear the tool call after processing
  if (options.toolCallId) {
    clearToolCall(options.toolCallId);
  }
}

// ─────────────────────────────────────────────────────────────
// Internal helpers (exported for capture.ts)
// ─────────────────────────────────────────────────────────────

/**
 * Run a function with a specific trace context (for internal use)
 */
export function runWithContext<T>(context: TraceContext, fn: () => T): T {
  return traceStorage.run(context, fn);
}
