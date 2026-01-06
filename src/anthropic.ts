/**
 * Anthropic Provider Entry Point
 *
 * @example
 * ```typescript
 * import { init, observe, flush } from '@lelemondev/sdk/anthropic';
 * import Anthropic from '@anthropic-ai/sdk';
 *
 * init({ apiKey: process.env.LELEMON_API_KEY });
 * const client = observe(new Anthropic());
 *
 * await client.messages.create({...});
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
import * as anthropic from './providers/anthropic';
import { setGlobalContext } from './core/capture';
import { getConfig } from './core/config';
import type { ObserveOptions } from './core/types';
import { clientWrapped, warn, debug } from './core/logger';

/**
 * Wrap an Anthropic client with automatic tracing
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

  if (!anthropic.canHandle(client)) {
    warn('Client is not an Anthropic client. Use @lelemondev/sdk/anthropic only with Anthropic SDK.');
    return client;
  }

  clientWrapped('anthropic');
  return wrapAnthropic(client) as T;
}

// Anthropic wrapper implementation
interface AnthropicShape {
  messages?: {
    create: CallableFunction;
    stream?: CallableFunction;
  };
}

function wrapAnthropic(client: unknown): unknown {
  const typed = client as AnthropicShape;

  return new Proxy(typed, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'messages' && value && typeof value === 'object') {
        return wrapAnthropicMessages(value as AnthropicShape['messages']);
      }

      return value;
    },
  });
}

function wrapAnthropicMessages(messages: AnthropicShape['messages']) {
  return new Proxy(messages!, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'create' && typeof value === 'function') {
        return anthropic.wrapMessagesCreate(value.bind(target));
      }

      if (prop === 'stream' && typeof value === 'function') {
        return anthropic.wrapMessagesStream(value.bind(target));
      }

      return value;
    },
  });
}
