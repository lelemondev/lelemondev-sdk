/**
 * Core types for Lelemon SDK
 */

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

export interface LelemonConfig {
  /** API key (or set LELEMON_API_KEY env var) */
  apiKey?: string;
  /** API endpoint (default: https://lelemon.dev) */
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
}

// ─────────────────────────────────────────────────────────────
// Provider Detection
// ─────────────────────────────────────────────────────────────

export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'bedrock' | 'openrouter' | 'unknown';

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

export type SpanType = 'llm' | 'tool' | 'retrieval' | 'custom';

export interface CreateTraceRequest {
  /** Span type (default: 'llm') */
  spanType?: SpanType;
  /** Span name (for tool: tool name, for LLM: model name) */
  name?: string;
  provider: ProviderName;
  model: string;
  input: unknown;
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status: 'success' | 'error';
  errorMessage?: string;
  errorStack?: string;
  streaming: boolean;
  sessionId?: string;
  userId?: string;
  /** Parent span ID for nested spans */
  parentSpanId?: string;
  /** Tool call ID (Anthropic/OpenAI tool_use id) */
  toolCallId?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
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
