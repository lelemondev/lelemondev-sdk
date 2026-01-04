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

import type { ProviderName, TokenUsage } from '../core/types';
import { safeExtract, getNestedValue, isValidNumber } from './base';
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
      const extracted = extractChatCompletion(response as ChatCompletionResponse);

      captureTrace({
        provider: PROVIDER_NAME,
        model: request.model || extracted.model || 'unknown',
        input: request.messages,
        output: extracted.output,
        inputTokens: extracted.tokens?.inputTokens || 0,
        outputTokens: extracted.tokens?.outputTokens || 0,
        durationMs,
        status: 'success',
        streaming: false,
        metadata: extracted.metadata,
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
  const chunks: string[] = [];
  let tokens: TokenUsage | null = null;
  let generationId: string | null = null;
  let error: Error | null = null;

  try {
    for await (const chunk of stream) {
      const c = chunk as StreamChunk;

      // Extract generation ID from first chunk
      if (!generationId && c.id) {
        generationId = c.id;
      }

      // Extract content from chunk
      const content = c.choices?.[0]?.delta?.content;
      if (content) {
        chunks.push(content);
      }

      // Extract tokens if available (usually in last chunk)
      const chunkTokens = extractStreamChunkTokens(c);
      if (chunkTokens) {
        tokens = chunkTokens;
      }

      yield chunk;
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
    throw err;
  } finally {
    const durationMs = Date.now() - startTime;
    const output = chunks.join('');

    const metadata: Record<string, unknown> = {};
    if (generationId) {
      metadata.generationId = generationId;
    }

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
        output,
        inputTokens: tokens?.inputTokens || 0,
        outputTokens: tokens?.outputTokens || 0,
        durationMs,
        status: 'success',
        streaming: true,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Extraction Helpers
// ─────────────────────────────────────────────────────────────

function extractChatCompletion(response: ChatCompletionResponse): {
  model: string | null;
  output: unknown;
  tokens: TokenUsage | null;
  metadata: Record<string, unknown>;
} {
  const model = response.model || null;
  const output = response.choices?.[0]?.message?.content || null;
  const tokens = extractTokens(response);

  const metadata: Record<string, unknown> = {};

  // Capture generation ID for async usage lookup
  if (response.id) {
    metadata.generationId = response.id;
  }

  return {
    model,
    output,
    tokens,
    metadata: Object.keys(metadata).length > 0 ? metadata : {},
  };
}

function extractTokens(response: ChatCompletionResponse): TokenUsage | null {
  const usage = response.usage;
  if (!usage) return null;

  const promptTokens = usage.prompt_tokens;
  const completionTokens = usage.completion_tokens;
  const totalTokens = usage.total_tokens;

  if (!isValidNumber(promptTokens) && !isValidNumber(completionTokens)) {
    return null;
  }

  return {
    inputTokens: isValidNumber(promptTokens) ? promptTokens : 0,
    outputTokens: isValidNumber(completionTokens) ? completionTokens : 0,
    totalTokens: isValidNumber(totalTokens) ? totalTokens : 0,
  };
}

function extractStreamChunkTokens(chunk: StreamChunk): TokenUsage | null {
  const usage = chunk.usage;
  if (!usage) return null;

  return {
    inputTokens: isValidNumber(usage.prompt_tokens) ? usage.prompt_tokens : 0,
    outputTokens: isValidNumber(usage.completion_tokens) ? usage.completion_tokens : 0,
    totalTokens: 0,
  };
}
