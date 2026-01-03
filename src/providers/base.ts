/**
 * Base Provider Interface
 *
 * All provider wrappers must implement this interface.
 * Uses Strategy pattern for different LLM providers.
 */

import type { ProviderName, TokenUsage } from '../core/types';

// ─────────────────────────────────────────────────────────────
// Provider Interface
// ─────────────────────────────────────────────────────────────

export interface BaseProvider<TClient = unknown> {
  /** Provider name */
  readonly name: ProviderName;

  /**
   * Check if this provider can handle the given client
   */
  canHandle(client: unknown): boolean;

  /**
   * Wrap the client with tracing
   */
  wrap(client: TClient): TClient;
}

// ─────────────────────────────────────────────────────────────
// Extraction Interfaces
// ─────────────────────────────────────────────────────────────

export interface ExtractedData {
  model: string;
  input: unknown;
  output: unknown;
  tokens: TokenUsage | null;
  streaming: boolean;
}

export interface RequestInfo {
  model: string;
  input: unknown;
  streaming: boolean;
}

export interface ResponseInfo {
  output: unknown;
  tokens: TokenUsage | null;
}

// ─────────────────────────────────────────────────────────────
// Method Wrapper Types
// ─────────────────────────────────────────────────────────────

export type AsyncMethod = (...args: unknown[]) => Promise<unknown>;

export interface WrapContext {
  provider: ProviderName;
  method: string;
  startTime: number;
}

// ─────────────────────────────────────────────────────────────
// Helper: Safe extraction with fallback
// ─────────────────────────────────────────────────────────────

/**
 * Safely extract a value with fallback
 * Never throws, always returns fallback on error
 */
export function safeExtract<T>(
  fn: () => T,
  fallback: T
): T {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Safely extract nested property
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  try {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current == null || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  } catch {
    return undefined;
  }
}

/**
 * Check if value is a valid number
 */
export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}
