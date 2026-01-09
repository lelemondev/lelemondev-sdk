/**
 * Core types for Lelemon SDK
 */

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

export interface ServiceConfig {
  /** Service name (e.g., "my-ai-chatbot") */
  name?: string;
  /** Service version (e.g., "1.2.3") */
  version?: string;
  /** Deployment environment (e.g., "production", "staging", "development") */
  environment?: string;
}

export interface LelemonConfig {
  /** API key (or set LELEMON_API_KEY env var) */
  apiKey?: string;
  /** API endpoint (default: https://api.lelemon.dev) */
  endpoint?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Disable tracing */
  disabled?: boolean;
  /** Batch size before flush (default: 10) */
  batchSize?: number;
  /** Auto-flush interval in ms (default: 1000) */
  flushIntervalMs?: number;
  /** Request timeout in ms (default: 10000) */
  requestTimeoutMs?: number;
  /** Service metadata for telemetry */
  service?: ServiceConfig;
}

// ─────────────────────────────────────────────────────────────
// SDK Telemetry
// ─────────────────────────────────────────────────────────────

export interface SDKTelemetry {
  /** SDK name */
  'telemetry.sdk.name': string;
  /** SDK version */
  'telemetry.sdk.version': string;
  /** SDK language */
  'telemetry.sdk.language': string;
  /** Runtime name (nodejs, deno, bun, browser) */
  'process.runtime.name'?: string;
  /** Runtime version */
  'process.runtime.version'?: string;
  /** OS type (linux, darwin, windows) */
  'os.type'?: string;
  /** Service name */
  'service.name'?: string;
  /** Service version */
  'service.version'?: string;
  /** Deployment environment */
  'deployment.environment'?: string;
}

// ─────────────────────────────────────────────────────────────
// Provider Detection
// ─────────────────────────────────────────────────────────────

export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'bedrock' | 'openrouter' | 'agent' | 'unknown';

export interface ProviderInfo {
  name: ProviderName;
  version?: string;
}

// ─────────────────────────────────────────────────────────────
// Trace Data
// ─────────────────────────────────────────────────────────────

export interface TraceData {
  id?: string;
  provider: ProviderName;
  model: string;
  input: unknown;
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status: 'success' | 'error';
  error?: {
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
  streaming: boolean;
  timestamp: Date;
}

// ─────────────────────────────────────────────────────────────
// Token Usage
// ─────────────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Anthropic: cache_read_input_tokens */
  cacheReadTokens?: number;
  /** Anthropic: cache_creation_input_tokens */
  cacheWriteTokens?: number;
  /** OpenAI o1/o3: completion_tokens_details.reasoning_tokens */
  reasoningTokens?: number;
}

// ─────────────────────────────────────────────────────────────
// Observe Options
// ─────────────────────────────────────────────────────────────

export interface ObserveOptions {
  /** Session ID to group related calls */
  sessionId?: string;
  /** User ID for the end user */
  userId?: string;
  /** Custom metadata added to all traces */
  metadata?: Record<string, unknown>;
  /** Tags for filtering */
  tags?: string[];
}

// ─────────────────────────────────────────────────────────────
// API Request/Response (for transport)
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Span Types
// ─────────────────────────────────────────────────────────────

export type SpanType = 'llm' | 'agent' | 'tool' | 'retrieval' | 'embedding' | 'guardrail' | 'rerank' | 'custom';

export interface CreateTraceRequest {
  // ─── Provider & Model ───
  provider: ProviderName;
  model: string;

  // ─── Raw Data (server parses) ───
  /** Input sent to the LLM */
  input: unknown;
  /** Raw LLM response - server extracts tokens, output, tools, etc. */
  rawResponse?: unknown;

  // ─── Timing (SDK must measure) ───
  /** Total duration in milliseconds */
  durationMs: number;
  /** Time to first token in ms (streaming only) */
  firstTokenMs?: number;

  // ─── Status ───
  status: 'success' | 'error';
  streaming: boolean;
  errorMessage?: string;
  errorStack?: string;

  // ─── Context ───
  sessionId?: string;
  userId?: string;
  /** Trace ID (groups spans together) */
  traceId?: string;
  /** Unique span ID */
  spanId?: string;
  /** Parent span ID for nested spans */
  parentSpanId?: string;
  /** Tool call ID (Anthropic/OpenAI tool_use id) */
  toolCallId?: string;

  metadata?: Record<string, unknown>;
  tags?: string[];

  // ─── Manual Spans ───
  /** Span type (default: 'llm') */
  spanType?: SpanType;
  /** Span name (for tool: tool name, for LLM: model name) */
  name?: string;

  // ─── Legacy fields (used when rawResponse is not provided) ───
  /** @deprecated Server extracts from rawResponse */
  output?: unknown;
  /** @deprecated Server extracts from rawResponse */
  inputTokens?: number;
  /** @deprecated Server extracts from rawResponse */
  outputTokens?: number;
  /** @deprecated Server extracts from rawResponse */
  stopReason?: string;
  /** @deprecated Server extracts from rawResponse */
  cacheReadTokens?: number;
  /** @deprecated Server extracts from rawResponse */
  cacheWriteTokens?: number;
  /** @deprecated Server extracts from rawResponse */
  reasoningTokens?: number;
  /** @deprecated Server extracts from rawResponse */
  thinking?: string;
}

// ─────────────────────────────────────────────────────────────
// Manual Span Capture
// ─────────────────────────────────────────────────────────────

export interface CaptureSpanOptions {
  /** Span type */
  type: SpanType;
  /** Span name (tool name, retrieval source, custom name) */
  name: string;
  /** Input data */
  input: unknown;
  /** Output data */
  output: unknown;
  /** Duration in milliseconds */
  durationMs: number;
  /** Status */
  status?: 'success' | 'error';
  /** Error message if status is 'error' */
  errorMessage?: string;
  /** Tool call ID (for linking tool results) */
  toolCallId?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}
