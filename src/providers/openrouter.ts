/**
 * OpenRouter Provider Wrapper
 *
 * Wraps OpenAI SDK configured with OpenRouter's API.
 * OpenRouter provides unified access to 400+ models from multiple providers.
 *
 * Traced methods:
 * - chat.completions.create()
 *
 * Supports both streaming and non-streaming responses.
 *
 * @see https://openrouter.ai/docs
 */

import type { ProviderName } from '../core/types';
import { captureTrace, captureError } from '../core/capture';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const OPENROUTER_BASE_URL = 'openrouter.ai';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface OpenRouterClient {
  baseURL?: string;
  chat?: {
    completions: {
      create: (...args: unknown[]) => Promise<unknown>;
    };
  };
}

interface ChatCompletionRequest {
  model?: string;
  messages?: unknown[];
  stream?: boolean;
  // OpenRouter-specific fields
  provider?: {
    order?: string[];
    allow_fallbacks?: boolean;
    data_collection?: 'allow' | 'deny';
    quantizations?: string[];
  };
  [key: string]: unknown;
}

interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
      role?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  // OpenRouter may include additional fields
  [key: string]: unknown;
}

interface StreamChunk {
  id?: string;
  choices?: Array<{
    delta?: {
      content?: string;
      role?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

// ─────────────────────────────────────────────────────────────
// Provider Implementation
// ─────────────────────────────────────────────────────────────

export const PROVIDER_NAME: ProviderName = 'openrouter';

/**
 * Check if client is OpenAI SDK configured for OpenRouter
 */
export function canHandle(client: unknown): boolean {
  if (!client || typeof client !== 'object') return false;

  const c = client as OpenRouterClient;

  // Must have chat.completions (OpenAI SDK structure)
  if (!c.chat?.completions?.create) return false;

  // Check if baseURL points to OpenRouter
  const baseURL = c.baseURL || '';
  return baseURL.includes(OPENROUTER_BASE_URL);
}

/**
 * Wrap OpenRouter client with tracing
 */
export function wrap(client: unknown): unknown {
  const openrouterClient = client as OpenRouterClient;

  return new Proxy(openrouterClient, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'chat' && value && typeof value === 'object') {
        return wrapChatNamespace(value as OpenRouterClient['chat']);
      }

      return value;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Namespace Wrappers
// ─────────────────────────────────────────────────────────────

function wrapChatNamespace(chat: OpenRouterClient['chat']) {
  if (!chat) return chat;

  return new Proxy(chat, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'completions' && value && typeof value === 'object') {
        return wrapChatCompletions(value as { create: (...args: unknown[]) => Promise<unknown> });
      }

      return value;
    },
  });
}

function wrapChatCompletions(completions: { create: (...args: unknown[]) => Promise<unknown> }) {
  return new Proxy(completions, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'create' && typeof value === 'function') {
        return wrapChatCreate(value.bind(target));
      }

      return value;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Method Wrapper
// ─────────────────────────────────────────────────────────────

function wrapChatCreate(originalFn: (...args: unknown[]) => Promise<unknown>) {
  return async function wrappedChatCreate(...args: unknown[]): Promise<unknown> {
    const startTime = Date.now();
    const request = (args[0] || {}) as ChatCompletionRequest;
    const isStreaming = request.stream === true;

    try {
      const response = await originalFn(...args);

      if (isStreaming && isAsyncIterable(response)) {
        return wrapStream(response, request, startTime);
      }

      // Non-streaming response
      const durationMs = Date.now() - startTime;
      const chatResponse = response as ChatCompletionResponse;

      captureTrace({
        provider: PROVIDER_NAME,
        model: request.model || chatResponse.model || 'unknown',
        input: request.messages,
        rawResponse: response,
        durationMs,
        status: 'success',
        streaming: false,
      });

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      captureError({
        provider: PROVIDER_NAME,
        model: request.model || 'unknown',
        input: request.messages,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs,
        streaming: isStreaming,
      });

      throw error;
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Streaming Support
// ─────────────────────────────────────────────────────────────

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value != null && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function';
}

async function* wrapStream(
  stream: AsyncIterable<unknown>,
  request: ChatCompletionRequest,
  startTime: number
): AsyncIterable<unknown> {
  // Reconstruct response object from stream
  const finalResponse: ChatCompletionResponse = {
    choices: [{ message: { content: '', role: 'assistant' }, finish_reason: '' }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  };
  let error: Error | null = null;
  let firstTokenMs: number | undefined;
  let firstTokenReceived = false;

  try {
    for await (const chunk of stream) {
      const c = chunk as StreamChunk;

      // Extract generation ID
      if (!finalResponse.id && c.id) {
        finalResponse.id = c.id;
      }

      // Accumulate content
      const content = c.choices?.[0]?.delta?.content;
      if (content) {
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          firstTokenMs = Date.now() - startTime;
        }
        finalResponse.choices![0].message!.content += content;
      }

      // Capture finish_reason
      const finishReason = c.choices?.[0]?.finish_reason;
      if (finishReason) {
        finalResponse.choices![0].finish_reason = finishReason;
      }

      // Capture usage (usually in last chunk)
      if (c.usage) {
        finalResponse.usage = c.usage;
      }

      yield chunk;
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
    throw err;
  } finally {
    const durationMs = Date.now() - startTime;

    if (error) {
      captureError({
        provider: PROVIDER_NAME,
        model: request.model || 'unknown',
        input: request.messages,
        error,
        durationMs,
        streaming: true,
      });
    } else {
      captureTrace({
        provider: PROVIDER_NAME,
        model: request.model || 'unknown',
        input: request.messages,
        rawResponse: finalResponse,
        durationMs,
        status: 'success',
        streaming: true,
        firstTokenMs,
      });
    }
  }
}

