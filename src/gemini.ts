/**
 * Google Gemini Provider Entry Point
 *
 * @example
 * ```typescript
 * import { init, observe, flush } from '@lelemondev/sdk/gemini';
 * import { GoogleGenerativeAI } from '@google/generative-ai';
 *
 * init({ apiKey: process.env.LELEMON_API_KEY });
 * const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
 * const model = observe(genAI.getGenerativeModel({ model: 'gemini-pro' }));
 *
 * await model.generateContent('Hello!');
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
import { getConfig } from './core/config';
import type { ObserveOptions } from './core/types';
import { clientWrapped, warn, debug } from './core/logger';

/**
 * Wrap a Gemini model with automatic tracing
 *
 * Supports both @google/generative-ai (old) and @google/genai (new) SDKs.
 */
export function observe<T>(client: T, options?: ObserveOptions): T {
  const config = getConfig();
  if (config.disabled) {
    debug('Tracing disabled, returning unwrapped client');
    return client;
  }

  // New @google/genai SDK
  if (googleGenai.canHandle(client)) {
    clientWrapped('gemini');
    return googleGenai.wrap(client, options) as T;
  }

  // Old @google/generative-ai SDK
  if (gemini.canHandle(client)) {
    clientWrapped('gemini');
    return gemini.wrap(client, options) as T;
  }

  warn('Client is not a Gemini model. Use @lelemondev/sdk/gemini with Google Generative AI or Google GenAI SDK.');
  return client;
}
