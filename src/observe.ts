/**
 * Observe Function
 *
 * Main entry point for wrapping LLM clients with automatic tracing.
 */

import * as openai from './providers/openai';
import * as anthropic from './providers/anthropic';
import { setGlobalContext } from './core/capture';
import { getConfig } from './core/config';
import type { ObserveOptions } from './core/types';

// ─────────────────────────────────────────────────────────────
// Observe Function
// ─────────────────────────────────────────────────────────────

/**
 * Wrap an LLM client with automatic tracing
 *
 * @param client - OpenAI or Anthropic client instance
 * @param options - Optional context (sessionId, userId, etc.)
 * @returns The wrapped client with the same type
 *
 * @example
 * import { observe } from '@lelemondev/sdk';
 * import OpenAI from 'openai';
 *
 * const openai = observe(new OpenAI());
 *
 * // All calls are now automatically traced
 * const response = await openai.chat.completions.create({...});
 */
export function observe<T>(client: T, options?: ObserveOptions): T {
  // Set global context if provided
  if (options) {
    setGlobalContext(options);
  }

  // Check if disabled
  const config = getConfig();
  if (config.disabled) {
    return client;
  }

  // Detect and wrap based on client shape
  if (openai.canHandle(client)) {
    if (config.debug) {
      console.log('[Lelemon] Wrapping OpenAI client');
    }
    return wrapOpenAI(client) as T;
  }

  if (anthropic.canHandle(client)) {
    if (config.debug) {
      console.log('[Lelemon] Wrapping Anthropic client');
    }
    return wrapAnthropic(client) as T;
  }

  // Unknown client type
  console.warn(
    '[Lelemon] Unknown client type. Tracing not enabled. ' +
    'Supported: OpenAI, Anthropic'
  );

  return client;
}

// ─────────────────────────────────────────────────────────────
// OpenAI Wrapper
// ─────────────────────────────────────────────────────────────

interface OpenAIShape {
  chat?: { completions: { create: CallableFunction } };
  completions?: { create: CallableFunction };
  embeddings?: { create: CallableFunction };
}

function wrapOpenAI(client: unknown): unknown {
  const typed = client as OpenAIShape;

  return new Proxy(typed, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'chat' && value && typeof value === 'object') {
        return wrapOpenAIChat(value as OpenAIShape['chat']);
      }

      if (prop === 'completions' && value && typeof value === 'object') {
        return wrapOpenAICompletions(value as OpenAIShape['completions']);
      }

      if (prop === 'embeddings' && value && typeof value === 'object') {
        return wrapOpenAIEmbeddings(value as OpenAIShape['embeddings']);
      }

      return value;
    },
  });
}

function wrapOpenAIChat(chat: OpenAIShape['chat']) {
  return new Proxy(chat!, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'completions' && value && typeof value === 'object') {
        return wrapOpenAIChatCompletions(value as { create: CallableFunction });
      }

      return value;
    },
  });
}

function wrapOpenAIChatCompletions(completions: { create: CallableFunction }) {
  return new Proxy(completions, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'create' && typeof value === 'function') {
        return openai.wrapChatCreate(value.bind(target));
      }

      return value;
    },
  });
}

function wrapOpenAICompletions(completions: OpenAIShape['completions']) {
  return new Proxy(completions!, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'create' && typeof value === 'function') {
        return openai.wrapCompletionCreate(value.bind(target));
      }

      return value;
    },
  });
}

function wrapOpenAIEmbeddings(embeddings: OpenAIShape['embeddings']) {
  return new Proxy(embeddings!, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'create' && typeof value === 'function') {
        return openai.wrapEmbeddingsCreate(value.bind(target));
      }

      return value;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Anthropic Wrapper
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────

/**
 * Create a scoped observe function with preset context
 *
 * @example
 * const observeWithSession = createObserve({
 *   sessionId: 'session-123',
 *   userId: 'user-456',
 * });
 *
 * const openai = observeWithSession(new OpenAI());
 */
export function createObserve(defaultOptions: ObserveOptions) {
  return function scopedObserve<T>(client: T, options?: ObserveOptions): T {
    return observe(client, { ...defaultOptions, ...options });
  };
}
