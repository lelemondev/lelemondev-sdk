/**
 * Capture Module
 *
 * Handles trace capture and batching.
 * Called by providers to record LLM calls.
 */

import type { ProviderName, CreateTraceRequest, ObserveOptions } from './types';
import { getTransport } from './config';
import { traceCapture, traceCaptureError, debug } from './logger';

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
 * Capture a successful trace
 * Fire-and-forget - never throws
 */
export function captureTrace(params: CaptureTraceParams): void {
  try {
    const transport = getTransport();
    if (!transport.isEnabled()) {
      debug('Transport disabled, skipping trace capture');
      return;
    }

    const context = getGlobalContext();

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
      sessionId: context.sessionId,
      userId: context.userId,
      metadata: { ...context.metadata, ...params.metadata },
      tags: context.tags,
    };

    traceCapture(params.provider, params.model, params.durationMs, params.status);
    transport.enqueue(request);
  } catch (err) {
    traceCaptureError(params.provider, err instanceof Error ? err : new Error(String(err)));
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

    const context = getGlobalContext();

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
      sessionId: context.sessionId,
      userId: context.userId,
      metadata: { ...context.metadata, ...params.metadata },
      tags: context.tags,
    };

    traceCapture(params.provider, params.model, params.durationMs, 'error');
    debug('Error details', { message: params.error.message, stack: params.error.stack });
    transport.enqueue(request);
  } catch (err) {
    traceCaptureError(params.provider, err instanceof Error ? err : new Error(String(err)));
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
