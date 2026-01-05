/**
 * OpenAI Provider Wrapper
 *
 * Wraps the OpenAI SDK to automatically capture:
 * - chat.completions.create()
 * - responses.create() (new Responses API - recommended)
 * - completions.create() (legacy)
 * - embeddings.create()
 *
 * Supports both streaming and non-streaming responses.
 */

import type { ProviderName, TokenUsage } from '../core/types';
import { safeExtract, getNestedValue, isValidNumber } from './base';
import { captureTrace, captureError } from '../core/capture';

// ─────────────────────────────────────────────────────────────
// Types (minimal, to avoid SDK dependency)
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

interface StreamChunk {
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

// Responses API types (new recommended API)
interface ResponsesRequest {
  model?: string;
  input?: string | unknown[];
  instructions?: string;
  stream?: boolean;
  tools?: unknown[];
  [key: string]: unknown;
}

interface ResponsesResult {
  id?: string;
  output?: unknown[];
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
// Provider Implementation
// ─────────────────────────────────────────────────────────────

export const PROVIDER_NAME: ProviderName = 'openai';

/**
 * Check if client is OpenAI SDK
 */
export function canHandle(client: unknown): boolean {
  if (!client || typeof client !== 'object') return false;

  // Check constructor name
  const constructorName = client.constructor?.name;
  if (constructorName === 'OpenAI') return true;

  // Check for characteristic properties (chat.completions or responses)
  const c = client as Record<string, unknown>;
  return !!(c.chat && c.completions) || !!c.responses;
}

/**
 * Wrap OpenAI client with tracing
 */
export function wrap(client: unknown): unknown {
  const openaiClient = client as OpenAIClient;
  return new Proxy(openaiClient, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // Wrap nested objects (chat, completions, responses, etc.)
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
// Method Wrappers
// ─────────────────────────────────────────────────────────────

export function wrapChatCreate(originalFn: (...args: unknown[]) => Promise<unknown>) {
  return async function wrappedChatCreate(...args: unknown[]): Promise<unknown> {
    const startTime = Date.now();
    const request = (args[0] || {}) as ChatCompletionRequest;
    const isStreaming = request.stream === true;

    try {
      const response = await originalFn(...args);

      if (isStreaming && isAsyncIterable(response)) {
        // Return wrapped stream
        return wrapStream(response, request, startTime);
      }

      // Non-streaming response
      const durationMs = Date.now() - startTime;
      const extracted = extractChatCompletion(response);

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
        // Extended fields
        stopReason: extracted.finishReason || undefined,
        reasoningTokens: extracted.tokens?.reasoningTokens,
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

/**
 * Wrap responses.create() - new Responses API
 */
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
      const extracted = extractResponsesResult(response as ResponsesResult);

      captureTrace({
        provider: PROVIDER_NAME,
        model: request.model || 'unknown',
        input: { instructions: request.instructions, input: request.input },
        output: extracted.output,
        inputTokens: extracted.inputTokens,
        outputTokens: extracted.outputTokens,
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
        input: { instructions: request.instructions, input: request.input },
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs,
        streaming: isStreaming,
      });

      throw error;
    }
  };
}

export function wrapCompletionCreate(originalFn: (...args: unknown[]) => Promise<unknown>) {
  return async function wrappedCompletionCreate(...args: unknown[]): Promise<unknown> {
    const startTime = Date.now();
    const request = (args[0] || {}) as Record<string, unknown>;

    try {
      const response = await originalFn(...args);
      const durationMs = Date.now() - startTime;
      const extracted = extractLegacyCompletion(response);

      captureTrace({
        provider: PROVIDER_NAME,
        model: (request.model as string) || extracted.model || 'unknown',
        input: request.prompt,
        output: extracted.output,
        inputTokens: extracted.tokens?.inputTokens || 0,
        outputTokens: extracted.tokens?.outputTokens || 0,
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

export function wrapEmbeddingsCreate(originalFn: (...args: unknown[]) => Promise<unknown>) {
  return async function wrappedEmbeddingsCreate(...args: unknown[]): Promise<unknown> {
    const startTime = Date.now();
    const request = (args[0] || {}) as Record<string, unknown>;

    try {
      const response = await originalFn(...args);
      const durationMs = Date.now() - startTime;
      const tokens = extractEmbeddingTokens(response);

      captureTrace({
        provider: PROVIDER_NAME,
        model: (request.model as string) || 'unknown',
        input: request.input,
        output: '[embedding vectors]',
        inputTokens: tokens?.inputTokens || 0,
        outputTokens: 0,
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
  let finishReason: string | undefined;
  let error: Error | null = null;
  let firstTokenMs: number | undefined;
  let firstTokenReceived = false;

  try {
    for await (const chunk of stream) {
      const streamChunk = chunk as StreamChunk;

      // Extract content from chunk
      const content = extractStreamChunkContent(streamChunk);
      if (content) {
        // Measure time to first token
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          firstTokenMs = Date.now() - startTime;
        }
        chunks.push(content);
      }

      // Extract finish_reason if available
      const chunkFinishReason = streamChunk?.choices?.[0]?.finish_reason;
      if (chunkFinishReason) {
        finishReason = chunkFinishReason;
      }

      // Extract tokens if available (usually in last chunk)
      const chunkTokens = extractStreamChunkTokens(streamChunk);
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
        // Extended fields
        stopReason: finishReason,
        reasoningTokens: tokens?.reasoningTokens,
        firstTokenMs,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Extraction Helpers
// ─────────────────────────────────────────────────────────────

interface ExtractedChatCompletion {
  model: string | null;
  output: unknown;
  tokens: TokenUsage | null;
  finishReason: string | null;
}

function extractChatCompletion(response: unknown): ExtractedChatCompletion {
  const model = safeExtract(() => getNestedValue(response, 'model') as string, null);
  const output = safeExtract(
    () => getNestedValue(response, 'choices.0.message.content') as string,
    null
  );
  const finishReason = safeExtract(
    () => getNestedValue(response, 'choices.0.finish_reason') as string,
    null
  );
  const tokens = extractTokens(response);

  return { model, output, tokens, finishReason };
}

function extractLegacyCompletion(response: unknown): {
  model: string | null;
  output: unknown;
  tokens: TokenUsage | null;
} {
  const model = safeExtract(() => getNestedValue(response, 'model') as string, null);
  const output = safeExtract(
    () => getNestedValue(response, 'choices.0.text') as string,
    null
  );
  const tokens = extractTokens(response);

  return { model, output, tokens };
}

function extractTokens(response: unknown): TokenUsage | null {
  try {
    const usage = getNestedValue(response, 'usage');
    if (!usage || typeof usage !== 'object') return null;

    const u = usage as Record<string, unknown>;
    const promptTokens = u.prompt_tokens;
    const completionTokens = u.completion_tokens;
    const totalTokens = u.total_tokens;

    if (!isValidNumber(promptTokens) && !isValidNumber(completionTokens)) {
      return null;
    }

    // Extract reasoning_tokens from completion_tokens_details (o1/o3 models)
    let reasoningTokens: number | undefined;
    const completionDetails = u.completion_tokens_details as Record<string, unknown> | undefined;
    if (completionDetails && isValidNumber(completionDetails.reasoning_tokens)) {
      reasoningTokens = completionDetails.reasoning_tokens as number;
    }

    return {
      inputTokens: isValidNumber(promptTokens) ? promptTokens : 0,
      outputTokens: isValidNumber(completionTokens) ? completionTokens : 0,
      totalTokens: isValidNumber(totalTokens) ? totalTokens : 0,
      reasoningTokens,
    };
  } catch {
    return null;
  }
}

function extractEmbeddingTokens(response: unknown): TokenUsage | null {
  try {
    const usage = getNestedValue(response, 'usage');
    if (!usage || typeof usage !== 'object') return null;

    const u = usage as Record<string, unknown>;
    const promptTokens = u.prompt_tokens;
    const totalTokens = u.total_tokens;

    return {
      inputTokens: isValidNumber(promptTokens) ? promptTokens : 0,
      outputTokens: 0,
      totalTokens: isValidNumber(totalTokens) ? totalTokens : 0,
    };
  } catch {
    return null;
  }
}

function extractStreamChunkContent(chunk: StreamChunk): string | null {
  try {
    return chunk?.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

function extractStreamChunkTokens(chunk: StreamChunk): TokenUsage | null {
  try {
    const usage = chunk?.usage;
    if (!usage) return null;

    return {
      inputTokens: isValidNumber(usage.prompt_tokens) ? usage.prompt_tokens : 0,
      outputTokens: isValidNumber(usage.completion_tokens) ? usage.completion_tokens : 0,
      totalTokens: 0,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Responses API Helpers
// ─────────────────────────────────────────────────────────────

function extractResponsesResult(response: ResponsesResult): {
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  metadata: Record<string, unknown>;
} {
  // output_text is the primary text output
  let output: unknown = response.output_text || null;

  // If no output_text, try to extract from output array
  if (!output && response.output && Array.isArray(response.output)) {
    const textItems = response.output
      .filter((item: unknown) => {
        const i = item as Record<string, unknown>;
        return i.type === 'message' || i.type === 'text';
      })
      .map((item: unknown) => {
        const i = item as Record<string, unknown>;
        if (i.type === 'message' && i.content) {
          const content = i.content as Array<{ type: string; text?: string }>;
          return content
            .filter((c) => c.type === 'text' || c.type === 'output_text')
            .map((c) => c.text || '')
            .join('');
        }
        return (i as { text?: string }).text || '';
      });
    output = textItems.join('');
  }

  const usage = response.usage || {};
  const inputTokens = isValidNumber(usage.input_tokens) ? usage.input_tokens! : 0;
  const outputTokens = isValidNumber(usage.output_tokens) ? usage.output_tokens! : 0;

  const metadata: Record<string, unknown> = {};
  if (response.id) {
    metadata.responseId = response.id;
  }

  return {
    output,
    inputTokens,
    outputTokens,
    metadata: Object.keys(metadata).length > 0 ? metadata : {},
  };
}

async function* wrapResponsesStream(
  stream: AsyncIterable<unknown>,
  request: ResponsesRequest,
  startTime: number
): AsyncIterable<unknown> {
  const chunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let error: Error | null = null;

  try {
    for await (const event of stream) {
      const e = event as Record<string, unknown>;

      // Extract text content from streaming events
      if (e.type === 'response.output_text.delta' && e.delta) {
        chunks.push(e.delta as string);
      }

      // Extract usage from done event
      if (e.type === 'response.done' && e.response) {
        const resp = e.response as ResponsesResult;
        if (resp.usage) {
          inputTokens = resp.usage.input_tokens || 0;
          outputTokens = resp.usage.output_tokens || 0;
        }
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
        output: chunks.join(''),
        inputTokens,
        outputTokens,
        durationMs,
        status: 'success',
        streaming: true,
      });
    }
  }
}
