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
import * as gemini from './providers/gemini';
import { setGlobalContext } from './core/capture';
import { getConfig } from './core/config';
import type { ObserveOptions } from './core/types';
import { clientWrapped, warn, debug } from './core/logger';

/**
 * Wrap a Gemini model with automatic tracing
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

  if (!gemini.canHandle(client)) {
    warn('Client is not a Gemini model. Use @lelemondev/sdk/gemini only with Google Generative AI SDK.');
    return client;
  }

  clientWrapped('gemini');
  return gemini.wrap(client) as T;
}
