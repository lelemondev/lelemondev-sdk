/**
 * Core types for Lelemon SDK
 */

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

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

export interface CreateTraceRequest {
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
  metadata?: Record<string, unknown>;
  tags?: string[];
}
