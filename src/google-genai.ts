/**
 * Google GenAI Provider Entry Point
 *
 * @example
 * ```typescript
 * import { init, observe, flush } from '@lelemondev/sdk/google-genai';
 * import { GoogleGenAI } from '@google/genai';
 *
 * init({ apiKey: process.env.LELEMON_API_KEY });
 * const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
 * const client = observe(ai);
 *
 * const response = await client.models.generateContent({
 *   model: 'gemini-pro',
 *   contents: 'Hello!',
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
import * as googleGenai from './providers/google-genai';
import * as gemini from './providers/gemini';
import { setGlobalContext } from './core/capture';
import { getConfig } from './core/config';
import type { ObserveOptions } from './core/types';
import { clientWrapped, warn, debug } from './core/logger';

/**
 * Wrap a Google GenAI client with automatic tracing
 *
 * Supports both @google/genai (new) and @google/generative-ai (old) SDKs.
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

  // New @google/genai SDK
  if (googleGenai.canHandle(client)) {
    clientWrapped('gemini');
    return googleGenai.wrap(client) as T;
  }

  // Old @google/generative-ai SDK
  if (gemini.canHandle(client)) {
    clientWrapped('gemini');
    return gemini.wrap(client) as T;
  }

  warn('Client is not a Google GenAI or Gemini model. Use @lelemondev/sdk/google-genai with Google GenAI or Google Generative AI SDK.');
  return client;
}
