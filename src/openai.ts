/**
 * OpenAI Provider Entry Point
 *
 * @example
 * ```typescript
 * import { init, observe, flush } from '@lelemondev/sdk/openai';
 * import OpenAI from 'openai';
 *
 * init({ apiKey: process.env.LELEMON_API_KEY });
 * const client = observe(new OpenAI());
 *
 * await client.chat.completions.create({...});
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
import * as openai from './providers/openai';
import { getConfig } from './core/config';
import type { ObserveOptions } from './core/types';
import { clientWrapped, warn, debug } from './core/logger';

/**
 * Wrap an OpenAI client with automatic tracing
 */
export function observe<T>(client: T, options?: ObserveOptions): T {
  const config = getConfig();
  if (config.disabled) {
    debug('Tracing disabled, returning unwrapped client');
    return client;
  }

  if (!openai.canHandle(client)) {
    warn('Client is not an OpenAI client. Use @lelemondev/sdk/openai only with OpenAI SDK.');
    return client;
  }

  clientWrapped('openai');
  return wrapOpenAI(client, options) as T;
}

// OpenAI wrapper implementation
interface OpenAIShape {
  chat?: { completions: { create: CallableFunction } };
  responses?: { create: CallableFunction };
  completions?: { create: CallableFunction };
  embeddings?: { create: CallableFunction };
}

function wrapOpenAI(client: unknown, context?: ObserveOptions): unknown {
  const typed = client as OpenAIShape;

  return new Proxy(typed, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'chat' && value && typeof value === 'object') {
        return wrapOpenAIChat(value as OpenAIShape['chat'], context);
      }

      if (prop === 'responses' && value && typeof value === 'object') {
        return wrapOpenAIResponses(value as OpenAIShape['responses'], context);
      }

      if (prop === 'completions' && value && typeof value === 'object') {
        return wrapOpenAICompletions(value as OpenAIShape['completions'], context);
      }

      if (prop === 'embeddings' && value && typeof value === 'object') {
        return wrapOpenAIEmbeddings(value as OpenAIShape['embeddings'], context);
      }

      return value;
    },
  });
}

function wrapOpenAIChat(chat: OpenAIShape['chat'], context?: ObserveOptions) {
  return new Proxy(chat!, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'completions' && value && typeof value === 'object') {
        return wrapOpenAIChatCompletions(value as { create: CallableFunction }, context);
      }
      return value;
    },
  });
}

function wrapOpenAIChatCompletions(completions: { create: CallableFunction }, context?: ObserveOptions) {
  return new Proxy(completions, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'create' && typeof value === 'function') {
        return openai.wrapChatCreate(value.bind(target), context);
      }
      return value;
    },
  });
}

function wrapOpenAIResponses(responses: OpenAIShape['responses'], context?: ObserveOptions) {
  return new Proxy(responses!, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'create' && typeof value === 'function') {
        return openai.wrapResponsesCreate(value.bind(target), context);
      }
      return value;
    },
  });
}

function wrapOpenAICompletions(completions: OpenAIShape['completions'], context?: ObserveOptions) {
  return new Proxy(completions!, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'create' && typeof value === 'function') {
        return openai.wrapCompletionCreate(value.bind(target), context);
      }
      return value;
    },
  });
}

function wrapOpenAIEmbeddings(embeddings: OpenAIShape['embeddings'], context?: ObserveOptions) {
  return new Proxy(embeddings!, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'create' && typeof value === 'function') {
        return openai.wrapEmbeddingsCreate(value.bind(target), context);
      }
      return value;
    },
  });
}
