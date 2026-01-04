/**
 * Centralized Logger
 *
 * Provides consistent debug logging across the SDK.
 * Enable via: init({ debug: true }) or LELEMON_DEBUG=true
 */

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

let debugEnabled = false;

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

/**
 * Enable or disable debug mode
 */
export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

/**
 * Check if debug mode is enabled
 */
export function isDebugEnabled(): boolean {
  // Config takes precedence, then check env var
  if (debugEnabled) return true;
  return getEnvVar('LELEMON_DEBUG') === 'true';
}

// ─────────────────────────────────────────────────────────────
// Logging Functions
// ─────────────────────────────────────────────────────────────

const PREFIX = '[Lelemon]';

/**
 * Log debug message (only when debug enabled)
 */
export function debug(message: string, data?: unknown): void {
  if (!isDebugEnabled()) return;
  logWithPrefix('debug', message, data);
}

/**
 * Log info message (only when debug enabled)
 */
export function info(message: string, data?: unknown): void {
  if (!isDebugEnabled()) return;
  logWithPrefix('info', message, data);
}

/**
 * Log warning message (always shown)
 */
export function warn(message: string, data?: unknown): void {
  logWithPrefix('warn', message, data);
}

/**
 * Log error message (always shown)
 */
export function error(message: string, data?: unknown): void {
  logWithPrefix('error', message, data);
}

// ─────────────────────────────────────────────────────────────
// Trace-specific logging
// ─────────────────────────────────────────────────────────────

/**
 * Log when a trace is captured
 */
export function traceCapture(provider: string, model: string, durationMs: number, status: string): void {
  if (!isDebugEnabled()) return;
  console.log(
    `${PREFIX} Captured trace: provider=${provider} model=${model} duration=${durationMs}ms status=${status}`
  );
}

/**
 * Log when a trace capture fails (always visible)
 */
export function traceCaptureError(provider: string, err: Error): void {
  console.error(`${PREFIX} Failed to capture trace: provider=${provider} error=${err.message}`);
}

/**
 * Log when a client is wrapped
 */
export function clientWrapped(provider: string): void {
  if (!isDebugEnabled()) return;
  console.log(`${PREFIX} Wrapped client: provider=${provider}`);
}

/**
 * Log transport events
 */
export function transportEvent(event: string, details?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return;
  if (details) {
    console.log(`${PREFIX} Transport: ${event}`, details);
  } else {
    console.log(`${PREFIX} Transport: ${event}`);
  }
}

/**
 * Log batch send details
 */
export function batchSend(count: number, endpoint: string): void {
  if (!isDebugEnabled()) return;
  console.log(`${PREFIX} Sending batch: count=${count} endpoint=${endpoint}`);
}

/**
 * Log batch send success
 */
export function batchSuccess(count: number, durationMs: number): void {
  if (!isDebugEnabled()) return;
  console.log(`${PREFIX} Batch sent successfully: count=${count} duration=${durationMs}ms`);
}

/**
 * Log batch send failure (always visible - errors should never be silent)
 */
export function batchError(count: number, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`${PREFIX} Batch send failed: count=${count} error=${message}`);
}

/**
 * Log request details (for deep debugging)
 */
export function requestDetails(method: string, url: string, bodySize: number): void {
  if (!isDebugEnabled()) return;
  console.log(`${PREFIX} Request: ${method} ${url} (${bodySize} bytes)`);
}

/**
 * Log response details
 */
export function responseDetails(status: number, durationMs: number): void {
  if (!isDebugEnabled()) return;
  console.log(`${PREFIX} Response: status=${status} duration=${durationMs}ms`);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function logWithPrefix(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (data !== undefined) {
    logFn(`${PREFIX} ${message}`, data);
  } else {
    logFn(`${PREFIX} ${message}`);
  }
}

function getEnvVar(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name];
  }
  return undefined;
}
