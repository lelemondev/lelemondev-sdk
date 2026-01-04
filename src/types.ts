/**
 * Lelemon SDK Types
 * Minimal, low-friction API for LLM observability
 */

// ============================================
// CONFIG
// ============================================

export interface LelemonConfig {
  /**
   * API key for authentication (starts with 'le_')
   * Can also be set via LELEMON_API_KEY env var
   */
  apiKey?: string;

  /**
   * API endpoint (default: https://lelemon.dev)
   */
  endpoint?: string;

  /**
   * Enable debug logging
   */
  debug?: boolean;

  /**
   * Disable tracing (useful for testing)
   */
  disabled?: boolean;

  /**
   * Number of items to batch before sending (default: 10)
   */
  batchSize?: number;

  /**
   * Interval in ms to flush pending items (default: 1000)
   */
  flushIntervalMs?: number;

  /**
   * Request timeout in ms (default: 10000)
   */
  requestTimeoutMs?: number;
}

// ============================================
// TRACE OPTIONS
// ============================================

export interface TraceOptions {
  /**
   * Initial input (user message, prompt, etc.)
   */
  input: unknown;

  /**
   * Session ID to group related traces
   */
  sessionId?: string;

  /**
   * User ID for the end user
   */
  userId?: string;

  /**
   * Custom metadata
   */
  metadata?: Record<string, unknown>;

  /**
   * Tags for filtering
   */
  tags?: string[];

  /**
   * Name for this trace (e.g., 'chat-agent', 'summarizer')
   */
  name?: string;
}

// ============================================
// MESSAGE FORMATS (OpenAI / Anthropic)
// ============================================

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContent[];
}

export interface AnthropicContent {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

// Generic message type (union)
export type Message = OpenAIMessage | AnthropicMessage | Record<string, unknown>;

// ============================================
// PARSED DATA
// ============================================

export interface ParsedTrace {
  systemPrompt?: string;
  userInput?: string;
  output?: string;
  llmCalls: ParsedLLMCall[];
  toolCalls: ParsedToolCall[];
  totalInputTokens: number;
  totalOutputTokens: number;
  models: string[];
  provider?: 'openai' | 'anthropic' | 'gemini' | 'bedrock' | 'unknown';
}

export interface ParsedLLMCall {
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  input?: unknown;
  output?: unknown;
  toolCalls?: ParsedToolCall[];
}

export interface ParsedToolCall {
  name: string;
  input: unknown;
  output?: unknown;
}

// ============================================
// API REQUEST/RESPONSE
// ============================================

export interface CreateTraceRequest {
  name?: string;
  sessionId?: string;
  userId?: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface CompleteTraceRequest {
  status: 'completed' | 'error';
  output?: unknown;
  errorMessage?: string;
  errorStack?: string;
  // Parsed data
  systemPrompt?: string;
  llmCalls?: ParsedLLMCall[];
  toolCalls?: ParsedToolCall[];
  models?: string[];
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCostUsd?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export type TraceStatus = 'active' | 'completed' | 'error';
