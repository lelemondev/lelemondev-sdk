/**
 * OpenRouter Provider Entry Point
 *
 * OpenRouter uses the OpenAI SDK but routes to different model providers.
 *
 * @example
 * ```typescript
 * import { init, observe, flush } from '@lelemondev/sdk/openrouter';
 * import OpenAI from 'openai';
 *
 * init({ apiKey: process.env.LELEMON_API_KEY });
 * const client = observe(new OpenAI({
 *   baseURL: 'https://openrouter.ai/api/v1',
 *   apiKey: process.env.OPENROUTER_API_KEY,
 * }));
 *
 * await client.chat.completions.create({
 *   model: 'anthropic/claude-3-opus',
 *   messages: [{...}],
 * });
 * await flush();
 * ```
 */

// Re-export core
export { init, flush, isEnabled } from './core/config';
export { trace, span, getTraceContext } from './core/context';
export { captureSpan } from './core/capture';

// Re-export types
export type {
  LelemonConfig,
  ObserveOptions,
  SpanType,
  CaptureSpanOptions,
} from './core/types';
export type { TraceContext, TraceOptions, SpanOptions } from './core/context';

// Provider-specific observe
import * as openrouter from './providers/openrouter';
import { setGlobalContext } from './core/capture';
import { getConfig } from './core/config';
import type { ObserveOptions } from './core/types';
import { clientWrapped, warn, debug } from './core/logger';

/**
 * Wrap an OpenRouter client (OpenAI SDK with OpenRouter baseURL) with automatic tracing
 */
export function observe<T>(client: T, options?: ObserveOptions): T {
  if (options) {
    setGlobalContext(options);
  }

  const config = getConfig();
  if (config.disabled) {
    debug('Tracing disabled, returning unwrapped client');
    return client;
  }

  if (!openrouter.canHandle(client)) {
    warn('Client is not configured for OpenRouter. Ensure baseURL is set to openrouter.ai.');
    return client;
  }

  clientWrapped('openrouter');
  return openrouter.wrap(client) as T;
}
