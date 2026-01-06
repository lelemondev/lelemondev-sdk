/**
 * Lelemon SDK - Core
 *
 * This is the core module. For observing LLM clients, use provider-specific imports:
 *
 * @example OpenAI
 * ```typescript
 * import { init, observe, flush } from '@lelemondev/sdk/openai';
 * ```
 *
 * @example Anthropic
 * ```typescript
 * import { init, observe, flush } from '@lelemondev/sdk/anthropic';
 * ```
 *
 * @example AWS Bedrock
 * ```typescript
 * import { init, observe, flush } from '@lelemondev/sdk/bedrock';
 * ```
 *
 * @example Google Gemini
 * ```typescript
 * import { init, observe, flush } from '@lelemondev/sdk/gemini';
 * ```
 *
 * @example OpenRouter
 * ```typescript
 * import { init, observe, flush } from '@lelemondev/sdk/openrouter';
 * ```
 */

// ─────────────────────────────────────────────────────────────
// Core API
// ─────────────────────────────────────────────────────────────

// Configuration
export { init, flush, isEnabled } from './core/config';

// Trace hierarchy
export { trace, span, getTraceContext } from './core/context';

// Manual span capture (lower-level API)
export { captureSpan } from './core/capture';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type {
  LelemonConfig,
  ObserveOptions,
  ProviderName,
  SpanType,
  CaptureSpanOptions,
} from './core/types';

export type { TraceContext, TraceOptions, SpanOptions } from './core/context';
