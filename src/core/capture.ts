/**
 * Capture Module
 *
 * Handles trace capture and batching.
 * Called by providers to record LLM calls.
 */

import type { ProviderName, CreateTraceRequest, ObserveOptions, CaptureSpanOptions, SpanType, RedactionConfig } from './types';
import { getTransport, getTelemetry, getConfig } from './config';
import { traceCapture, traceCaptureError, debug } from './logger';
import { getTraceContext, generateId } from './context';

// ─────────────────────────────────────────────────────────────
// Global context (set via observe options)
// ─────────────────────────────────────────────────────────────

// Use a global symbol to ensure single instance across all entry points
// This fixes the issue where @lelemondev/sdk and @lelemondev/sdk/bedrock
// would create separate globalContext due to bundler splitting
const GLOBAL_CONTEXT_KEY = Symbol.for('@lelemondev/sdk:globalContext');

function getGlobalContextStore(): { context: ObserveOptions } {
  const globalObj = globalThis as Record<symbol, { context: ObserveOptions } | undefined>;
  if (!globalObj[GLOBAL_CONTEXT_KEY]) {
    globalObj[GLOBAL_CONTEXT_KEY] = { context: {} };
  }
  return globalObj[GLOBAL_CONTEXT_KEY];
}

export function setGlobalContext(options: ObserveOptions): void {
  getGlobalContextStore().context = options;
  debug('Global context updated', options);
}

export function getGlobalContext(): ObserveOptions {
  return getGlobalContextStore().context;
}

// ─────────────────────────────────────────────────────────────
// Capture Functions
// ─────────────────────────────────────────────────────────────

export interface CaptureTraceParams {
  provider: ProviderName;
  model: string;
  input: unknown;
  durationMs: number;
  status: 'success' | 'error';
  streaming: boolean;
  metadata?: Record<string, unknown>;

  // Raw response (server extracts tokens, output, tools, etc.)
  rawResponse?: unknown;

  // Timing
  firstTokenMs?: number;

  // Manual span type
  spanType?: SpanType;
  name?: string;
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

    // Include SDK telemetry in metadata
    const telemetry = getTelemetry();

    const request: CreateTraceRequest = {
      provider: params.provider,
      model: params.model,
      input: sanitizeInput(params.input),
      rawResponse: params.rawResponse ? sanitize(params.rawResponse, 0) : undefined,
      durationMs: params.durationMs,
      status: params.status,
      streaming: params.streaming,
      firstTokenMs: params.firstTokenMs,
      sessionId: traceContext?.sessionId ?? globalContext.sessionId,
      userId: traceContext?.userId ?? globalContext.userId,
      // Hierarchy fields
      traceId: traceContext?.traceId,
      spanId,
      parentSpanId: traceContext?.currentSpanId,
      metadata: {
        ...globalContext.metadata,
        ...params.metadata,
        ...(traceContext ? { _traceName: traceContext.name } : {}),
        ...(telemetry ? { _telemetry: telemetry } : {}),
      },
      tags: globalContext.tags,
      // Manual span fields
      spanType: params.spanType,
      name: params.name,
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

    // Include SDK telemetry in metadata
    const telemetry = getTelemetry();

    const request: CreateTraceRequest = {
      provider: params.provider,
      model: params.model,
      input: sanitizeInput(params.input),
      durationMs: params.durationMs,
      status: 'error',
      errorMessage: params.error.message,
      streaming: params.streaming,
      sessionId: traceContext?.sessionId ?? globalContext.sessionId,
      userId: traceContext?.userId ?? globalContext.userId,
      traceId: traceContext?.traceId,
      spanId: generateId(),
      parentSpanId: traceContext?.currentSpanId,
      metadata: {
        ...globalContext.metadata,
        ...params.metadata,
        ...(traceContext ? { _traceName: traceContext.name } : {}),
        ...(telemetry ? { _telemetry: telemetry } : {}),
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

    // Include SDK telemetry in metadata
    const telemetry = getTelemetry();

    // Clean up internal metadata keys and add telemetry
    const cleanMetadata: Record<string, unknown> = {
      ...globalContext.metadata,
      ...options.metadata,
      ...(telemetry ? { _telemetry: telemetry } : {}),
    };
    delete cleanMetadata._traceId;
    delete cleanMetadata._parentSpanId;

    const request: CreateTraceRequest = {
      spanType: options.type,
      name: options.name,
      provider: 'unknown',
      model: options.name,
      input: sanitizeInput(options.input),
      // Manual spans use output directly (not rawResponse)
      output: sanitize(options.output, 0),
      durationMs: options.durationMs,
      status: options.status || 'success',
      errorMessage: options.errorMessage,
      streaming: false,
      sessionId: traceContext?.sessionId ?? globalContext.sessionId,
      userId: traceContext?.userId ?? globalContext.userId,
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

// Keys that should be redacted (authentication-related)
// Note: We use specific patterns to avoid false positives with LLM token counts
const SENSITIVE_KEYS = ['api_key', 'apikey', 'password', 'secret', 'authorization'];
const SENSITIVE_TOKEN_PATTERNS = ['access_token', 'auth_token', 'bearer_token', 'refresh_token', 'id_token', 'session_token'];

// Keys that contain "token" but are safe (LLM token counts)
const SAFE_TOKEN_KEYS = ['inputtokens', 'outputtokens', 'totaltokens', 'prompttokens', 'completiontokens', 'cachereadtokens', 'cachewritetokens', 'cachereadinputtokens', 'cachewriteinputtokens', 'reasoningtokens'];

// Built-in PII patterns
const BUILTIN_PATTERNS = {
  emails: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phones: /\b\d{9,}\b/g,
};

/**
 * Get redaction config from global config
 */
function getRedactionConfig(): RedactionConfig {
  return getConfig().redaction ?? {};
}

/**
 * Check if a key should be redacted
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();

  // Check if it's a safe token key (LLM token counts)
  if (SAFE_TOKEN_KEYS.includes(lowerKey)) {
    return false;
  }

  // Check sensitive patterns
  if (SENSITIVE_KEYS.some((k) => lowerKey.includes(k))) {
    return true;
  }

  // Check specific token patterns (auth tokens)
  if (SENSITIVE_TOKEN_PATTERNS.some((k) => lowerKey.includes(k))) {
    return true;
  }

  // Check custom keys from redaction config
  const customKeys = getRedactionConfig().keys ?? [];
  if (customKeys.some((k) => lowerKey.includes(k.toLowerCase()))) {
    return true;
  }

  return false;
}

/**
 * Apply PII redaction patterns to a string value
 */
function redactString(value: string): string {
  const config = getRedactionConfig();
  let result = value;

  // Apply custom patterns first
  for (const pattern of config.patterns ?? []) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }

  // Apply built-in email pattern if enabled
  if (config.emails) {
    result = result.replace(BUILTIN_PATTERNS.emails, '[EMAIL]');
  }

  // Apply built-in phone pattern if enabled
  if (config.phones) {
    result = result.replace(BUILTIN_PATTERNS.phones, '[PHONE]');
  }

  return result;
}

/**
 * Sanitize input before sending
 * - Truncates large strings
 * - Removes sensitive data
 * - Applies PII redaction patterns
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
    // Apply PII redaction patterns
    let result = redactString(value);
    // Truncate if too long
    if (result.length > MAX_STRING_LENGTH) {
      result = result.slice(0, MAX_STRING_LENGTH) + '...[truncated]';
    }
    return result;
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
      if (isSensitiveKey(key)) {
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

// ─────────────────────────────────────────────────────────────
// Test Helpers (exported for testing only)
// ─────────────────────────────────────────────────────────────

/** @internal - Exported for testing only */
export const __test__ = {
  sanitize,
  redactString,
  isSensitiveKey,
};
