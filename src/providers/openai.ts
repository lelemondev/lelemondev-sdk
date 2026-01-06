/**
 * OpenAI Provider Wrapper
 *
 * Wraps the OpenAI SDK to automatically capture LLM calls.
 * SDK thin: only captures timing and raw response.
 * Server smart: extracts tokens, output, tools, etc.
 */

import type { ProviderName } from '../core/types';
import { captureTrace, captureError } from '../core/capture';
import { registerToolCalls } from '../core/context';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface OpenAIClient {
  chat?: {
    completions: {
      create: (...args: unknown[]) => Promise<unknown>;
    };
  };
  responses?: {
    create: (...args: unknown[]) => Promise<unknown>;
  };
  completions?: {
    create: (...args: unknown[]) => Promise<unknown>;
  };
  embeddings?: {
    create: (...args: unknown[]) => Promise<unknown>;
  };
}

interface ChatCompletionRequest {
  model?: string;
  messages?: unknown[];
  stream?: boolean;
  [key: string]: unknown;
}

interface ToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

interface ResponsesRequest {
  model?: string;
  input?: string | unknown[];
  instructions?: string;
  stream?: boolean;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
// Provider Implementation
// ─────────────────────────────────────────────────────────────

export const PROVIDER_NAME: ProviderName = 'openai';

export function canHandle(client: unknown): boolean {
  if (!client || typeof client !== 'object') return false;
  const constructorName = client.constructor?.name;
  if (constructorName === 'OpenAI') return true;
  const c = client as Record<string, unknown>;
  return !!(c.chat && c.completions) || !!c.responses;
}

export function wrap(client: unknown): unknown {
  const openaiClient = client as OpenAIClient;
  return new Proxy(openaiClient, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'chat' && value && typeof value === 'object') {
        return wrapChatNamespace(value as OpenAIClient['chat']);
      }
      if (prop === 'responses' && value && typeof value === 'object') {
        return wrapResponsesNamespace(value as OpenAIClient['responses']);
      }
      if (prop === 'completions' && value && typeof value === 'object') {
        return wrapCompletionsNamespace(value as OpenAIClient['completions']);
      }
      if (prop === 'embeddings' && value && typeof value === 'object') {
        return wrapEmbeddingsNamespace(value as OpenAIClient['embeddings']);
      }
      return value;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Namespace Wrappers
// ─────────────────────────────────────────────────────────────

function wrapChatNamespace(chat: OpenAIClient['chat']) {
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

function wrapResponsesNamespace(responses: OpenAIClient['responses']) {
  if (!responses) return responses;
  return new Proxy(responses, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'create' && typeof value === 'function') {
        return wrapResponsesCreate(value.bind(target));
      }
      return value;
    },
  });
}

function wrapCompletionsNamespace(completions: OpenAIClient['completions']) {
  if (!completions) return completions;
  return new Proxy(completions, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'create' && typeof value === 'function') {
        return wrapCompletionCreate(value.bind(target));
      }
      return value;
    },
  });
}

function wrapEmbeddingsNamespace(embeddings: OpenAIClient['embeddings']) {
  if (!embeddings) return embeddings;
  return new Proxy(embeddings, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'create' && typeof value === 'function') {
        return wrapEmbeddingsCreate(value.bind(target));
      }
      return value;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Chat Completions
// ─────────────────────────────────────────────────────────────

export function wrapChatCreate(originalFn: (...args: unknown[]) => Promise<unknown>) {
  return async function wrappedChatCreate(...args: unknown[]): Promise<unknown> {
    const startTime = Date.now();
    const request = (args[0] || {}) as ChatCompletionRequest;
    const isStreaming = request.stream === true;

    try {
      const response = await originalFn(...args);

      if (isStreaming && isAsyncIterable(response)) {
        return wrapStream(response, request, startTime);
      }

      // Non-streaming: send raw response
      const durationMs = Date.now() - startTime;
      const chatResponse = response as ChatCompletionResponse;

      const spanId = captureTrace({
        provider: PROVIDER_NAME,
        model: request.model || chatResponse.model || 'unknown',
        input: request.messages,
        rawResponse: response, // Server extracts everything
        durationMs,
        status: 'success',
        streaming: false,
      });

      // Register tool calls for hierarchy
      if (spanId) {
        const toolCallIds = extractToolCallIds(chatResponse);
        if (toolCallIds.length > 0) {
          registerToolCalls(toolCallIds, spanId);
        }
      }

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
// Streaming
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
    choices: [{ message: { content: '', tool_calls: [] }, finish_reason: '' }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  };
  let error: Error | null = null;
  let firstTokenMs: number | undefined;
  let firstTokenReceived = false;

  // Track tool calls
  const toolCalls: Map<number, ToolCall> = new Map();

  try {
    for await (const chunk of stream) {
      const streamChunk = chunk as StreamChunk;

      // Accumulate content
      const content = streamChunk?.choices?.[0]?.delta?.content;
      if (content) {
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          firstTokenMs = Date.now() - startTime;
        }
        finalResponse.choices![0].message!.content += content;
      }

      // Track tool calls
      const deltaToolCalls = streamChunk?.choices?.[0]?.delta?.tool_calls;
      if (deltaToolCalls) {
        for (const tc of deltaToolCalls) {
          if (!toolCalls.has(tc.index)) {
            toolCalls.set(tc.index, { id: '', function: { name: '', arguments: '' } });
          }
          const existing = toolCalls.get(tc.index)!;
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.function!.name = tc.function.name;
          if (tc.function?.arguments) existing.function!.arguments += tc.function.arguments;
        }
      }

      // Capture finish_reason
      const finishReason = streamChunk?.choices?.[0]?.finish_reason;
      if (finishReason) {
        finalResponse.choices![0].finish_reason = finishReason;
      }

      // Capture usage (usually in last chunk)
      if (streamChunk?.usage) {
        finalResponse.usage = streamChunk.usage;
      }

      yield chunk;
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
    throw err;
  } finally {
    const durationMs = Date.now() - startTime;

    // Add tool calls to response
    if (toolCalls.size > 0) {
      finalResponse.choices![0].message!.tool_calls = Array.from(toolCalls.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, tc]) => tc);
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
      const spanId = captureTrace({
        provider: PROVIDER_NAME,
        model: request.model || 'unknown',
        input: request.messages,
        rawResponse: finalResponse,
        durationMs,
        status: 'success',
        streaming: true,
        firstTokenMs,
      });

      if (spanId) {
        const toolCallIds = extractToolCallIds(finalResponse);
        if (toolCallIds.length > 0) {
          registerToolCalls(toolCallIds, spanId);
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Responses API
// ─────────────────────────────────────────────────────────────

export function wrapResponsesCreate(originalFn: (...args: unknown[]) => Promise<unknown>) {
  return async function wrappedResponsesCreate(...args: unknown[]): Promise<unknown> {
    const startTime = Date.now();
    const request = (args[0] || {}) as ResponsesRequest;
    const isStreaming = request.stream === true;

    try {
      const response = await originalFn(...args);

      if (isStreaming && isAsyncIterable(response)) {
        return wrapResponsesStream(response, request, startTime);
      }

      const durationMs = Date.now() - startTime;
      captureTrace({
        provider: PROVIDER_NAME,
        model: request.model || 'unknown',
        input: { instructions: request.instructions, input: request.input },
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
        input: { instructions: request.instructions, input: request.input },
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs,
        streaming: isStreaming,
      });
      throw error;
    }
  };
}

async function* wrapResponsesStream(
  stream: AsyncIterable<unknown>,
  request: ResponsesRequest,
  startTime: number
): AsyncIterable<unknown> {
  const allEvents: unknown[] = [];
  let finalResponse: unknown = null;
  let error: Error | null = null;

  try {
    for await (const event of stream) {
      allEvents.push(event);
      const e = event as Record<string, unknown>;
      if (e.type === 'response.done' && e.response) {
        finalResponse = e.response;
      }
      yield event;
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
        input: { instructions: request.instructions, input: request.input },
        error,
        durationMs,
        streaming: true,
      });
    } else {
      captureTrace({
        provider: PROVIDER_NAME,
        model: request.model || 'unknown',
        input: { instructions: request.instructions, input: request.input },
        rawResponse: finalResponse || { streamEvents: allEvents },
        durationMs,
        status: 'success',
        streaming: true,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Legacy Completions
// ─────────────────────────────────────────────────────────────

export function wrapCompletionCreate(originalFn: (...args: unknown[]) => Promise<unknown>) {
  return async function wrappedCompletionCreate(...args: unknown[]): Promise<unknown> {
    const startTime = Date.now();
    const request = (args[0] || {}) as Record<string, unknown>;

    try {
      const response = await originalFn(...args);
      const durationMs = Date.now() - startTime;

      captureTrace({
        provider: PROVIDER_NAME,
        model: (request.model as string) || 'unknown',
        input: request.prompt,
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
        model: (request.model as string) || 'unknown',
        input: request.prompt,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs,
        streaming: false,
      });
      throw error;
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Embeddings
// ─────────────────────────────────────────────────────────────

export function wrapEmbeddingsCreate(originalFn: (...args: unknown[]) => Promise<unknown>) {
  return async function wrappedEmbeddingsCreate(...args: unknown[]): Promise<unknown> {
    const startTime = Date.now();
    const request = (args[0] || {}) as Record<string, unknown>;

    try {
      const response = await originalFn(...args);
      const durationMs = Date.now() - startTime;

      captureTrace({
        provider: PROVIDER_NAME,
        model: (request.model as string) || 'unknown',
        input: request.input,
        rawResponse: response,
        durationMs,
        status: 'success',
        streaming: false,
        spanType: 'embedding',
      });

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      captureError({
        provider: PROVIDER_NAME,
        model: (request.model as string) || 'unknown',
        input: request.input,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs,
        streaming: false,
      });
      throw error;
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function extractToolCallIds(response: ChatCompletionResponse): string[] {
  const ids: string[] = [];
  const toolCalls = response.choices?.[0]?.message?.tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      if (tc.id) ids.push(tc.id);
    }
  }
  return ids;
}
