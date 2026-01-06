/**
 * Capture Module
 *
 * Handles trace capture and batching.
 * Called by providers to record LLM calls.
 */

import type { ProviderName, CreateTraceRequest, ObserveOptions, CaptureSpanOptions, SpanType } from './types';
import { getTransport } from './config';
import { traceCapture, traceCaptureError, debug } from './logger';
import { getTraceContext, generateId } from './context';

// ─────────────────────────────────────────────────────────────
// Global context (set via observe options)
// ─────────────────────────────────────────────────────────────

let globalContext: ObserveOptions = {};

export function setGlobalContext(options: ObserveOptions): void {
  globalContext = options;
  debug('Global context updated', options);
}

export function getGlobalContext(): ObserveOptions {
  return globalContext;
}

// ─────────────────────────────────────────────────────────────
// Capture Functions
// ─────────────────────────────────────────────────────────────

export interface CaptureTraceParams {
  provider: ProviderName;
  model: string;
  input: unknown;
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status: 'success' | 'error';
  streaming: boolean;
  metadata?: Record<string, unknown>;
  // Extended fields (Phase 7.1)
  stopReason?: string;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  firstTokenMs?: number;
  thinking?: string;
}

export interface CaptureErrorParams {
  provider: ProviderName;
  model: string;
  input: unknown;
  error: Error;
  durationMs: number;
  streaming: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Capture a successful trace (LLM call)
 * Fire-and-forget - never throws
 * @returns The span ID, for linking tool calls to this LLM span
 */
export function captureTrace(params: CaptureTraceParams): string | undefined {
  try {
    const transport = getTransport();
    if (!transport.isEnabled()) {
      debug('Transport disabled, skipping trace capture');
      return undefined;
    }

    const globalContext = getGlobalContext();
    const traceContext = getTraceContext();
    const spanId = generateId();

    const request: CreateTraceRequest = {
      provider: params.provider,
      model: params.model,
      input: sanitizeInput(params.input),
      output: sanitizeOutput(params.output),
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      durationMs: params.durationMs,
      status: params.status,
      streaming: params.streaming,
      sessionId: globalContext.sessionId,
      userId: globalContext.userId,
      // Hierarchy fields (Phase 7.2) - use trace context if available
      traceId: traceContext?.traceId,
      spanId,
      parentSpanId: traceContext?.currentSpanId,
      metadata: {
        ...globalContext.metadata,
        ...params.metadata,
        // Include trace name for debugging
        ...(traceContext ? { _traceName: traceContext.name } : {}),
      },
      tags: globalContext.tags,
      // Extended fields (Phase 7.1)
      stopReason: params.stopReason,
      cacheReadTokens: params.cacheReadTokens,
      cacheWriteTokens: params.cacheWriteTokens,
      reasoningTokens: params.reasoningTokens,
      firstTokenMs: params.firstTokenMs,
      thinking: params.thinking,
    };

    traceCapture(params.provider, params.model, params.durationMs, params.status);
    transport.enqueue(request);

    return spanId;
  } catch (err) {
    traceCaptureError(params.provider, err instanceof Error ? err : new Error(String(err)));
    return undefined;
  }
}

/**
 * Capture an error trace
 * Fire-and-forget - never throws
 */
export function captureError(params: CaptureErrorParams): void {
  try {
    const transport = getTransport();
    if (!transport.isEnabled()) {
      debug('Transport disabled, skipping error capture');
      return;
    }

    const globalContext = getGlobalContext();
    const traceContext = getTraceContext();

    const request: CreateTraceRequest = {
      provider: params.provider,
      model: params.model,
      input: sanitizeInput(params.input),
      output: null,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: params.durationMs,
      status: 'error',
      errorMessage: params.error.message,
      errorStack: params.error.stack,
      streaming: params.streaming,
      sessionId: globalContext.sessionId,
      userId: globalContext.userId,
      // Hierarchy fields (Phase 7.2)
      traceId: traceContext?.traceId,
      spanId: generateId(),
      parentSpanId: traceContext?.currentSpanId,
      metadata: {
        ...globalContext.metadata,
        ...params.metadata,
        ...(traceContext ? { _traceName: traceContext.name } : {}),
      },
      tags: globalContext.tags,
    };

    traceCapture(params.provider, params.model, params.durationMs, 'error');
    debug('Error details', { message: params.error.message, stack: params.error.stack });
    transport.enqueue(request);
  } catch (err) {
    traceCaptureError(params.provider, err instanceof Error ? err : new Error(String(err)));
  }
}

// ─────────────────────────────────────────────────────────────
// Manual Span Capture
// ─────────────────────────────────────────────────────────────

/**
 * Manually capture a span (tool call, retrieval, custom)
 * Use this when auto-detection doesn't cover your use case
 *
 * @example
 * // Capture a tool call
 * captureSpan({
 *   type: 'tool',
 *   name: 'get_weather',
 *   input: { location: 'San Francisco' },
 *   output: { temperature: 72, conditions: 'sunny' },
 *   durationMs: 150,
 * });
 *
 * @example
 * // Capture a retrieval/RAG operation
 * captureSpan({
 *   type: 'retrieval',
 *   name: 'vector_search',
 *   input: { query: 'user question', k: 5 },
 *   output: { documents: [...] },
 *   durationMs: 50,
 * });
 */
export function captureSpan(options: CaptureSpanOptions): void {
  try {
    const transport = getTransport();
    if (!transport.isEnabled()) {
      debug('Transport disabled, skipping span capture');
      return;
    }

    const globalContext = getGlobalContext();
    const traceContext = getTraceContext();

    // Extract trace context from metadata if passed from span() in context.ts
    const metadataTraceId = (options.metadata as Record<string, unknown>)?._traceId as string | undefined;
    const metadataParentSpanId = (options.metadata as Record<string, unknown>)?._parentSpanId as string | undefined;

    // Clean up internal metadata keys
    const cleanMetadata = { ...globalContext.metadata, ...options.metadata };
    delete (cleanMetadata as Record<string, unknown>)._traceId;
    delete (cleanMetadata as Record<string, unknown>)._parentSpanId;

    const request: CreateTraceRequest = {
      spanType: options.type,
      name: options.name,
      provider: 'unknown', // Manual spans don't have a provider
      model: options.name, // Use name as model for compatibility
      input: sanitizeInput(options.input),
      output: sanitizeOutput(options.output),
      inputTokens: 0,
      outputTokens: 0,
      durationMs: options.durationMs,
      status: options.status || 'success',
      errorMessage: options.errorMessage,
      streaming: false,
      sessionId: globalContext.sessionId,
      userId: globalContext.userId,
      // Hierarchy fields (Phase 7.2)
      traceId: metadataTraceId ?? traceContext?.traceId,
      spanId: generateId(),
      parentSpanId: metadataParentSpanId ?? traceContext?.currentSpanId,
      toolCallId: options.toolCallId,
      metadata: cleanMetadata,
      tags: globalContext.tags,
    };

    debug(`Span captured: ${options.type}/${options.name}`, { durationMs: options.durationMs });
    transport.enqueue(request);
  } catch (err) {
    traceCaptureError('unknown', err instanceof Error ? err : new Error(String(err)));
  }
}

// ─────────────────────────────────────────────────────────────
// Sanitization (security)
// ─────────────────────────────────────────────────────────────

const MAX_STRING_LENGTH = 100_000; // 100KB per field
const SENSITIVE_KEYS = ['api_key', 'apikey', 'password', 'secret', 'token', 'authorization'];

/**
 * Sanitize input before sending
 * - Truncates large strings
 * - Removes sensitive data
 */
function sanitizeInput(input: unknown): unknown {
  return sanitize(input, 0);
}

/**
 * Sanitize output before sending
 */
function sanitizeOutput(output: unknown): unknown {
  return sanitize(output, 0);
}

function sanitize(value: unknown, depth: number): unknown {
  // Prevent infinite recursion
  if (depth > 10) return '[max depth exceeded]';

  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? value.slice(0, MAX_STRING_LENGTH) + '...[truncated]'
      : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, depth + 1));
  }

  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(value)) {
      // Redact sensitive keys
      if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitize(val, depth + 1);
      }
    }

    return sanitized;
  }

  // Functions, symbols, etc.
  return String(value);
}
