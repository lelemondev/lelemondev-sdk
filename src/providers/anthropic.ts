/**
 * Anthropic Provider Wrapper
 *
 * Wraps the Anthropic SDK to automatically capture:
 * - messages.create()
 * - messages.stream()
 *
 * Supports both streaming and non-streaming responses.
 */

import type { ProviderName, TokenUsage } from '../core/types';
import { safeExtract, getNestedValue, isValidNumber } from './base';
import { captureTrace, captureError } from '../core/capture';
import { registerToolCalls } from '../core/context';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface AnthropicClient {
  messages?: {
    create: (...args: unknown[]) => Promise<unknown>;
    stream?: (...args: unknown[]) => unknown;
  };
  completions?: {
    create: (...args: unknown[]) => Promise<unknown>;
  };
}

interface MessageRequest {
  model?: string;
  messages?: unknown[];
  system?: string;
  stream?: boolean;
  max_tokens?: number;
  [key: string]: unknown;
}

interface ContentBlock {
  type: string;
  text?: string;
  // tool_use specific fields
  id?: string;
  name?: string;
  input?: unknown;
  // thinking block (extended thinking)
  thinking?: string;
}

interface MessageResponse {
  id?: string;
  type?: string;
  role?: string;
  content?: ContentBlock[];
  model?: string;
  stop_reason?: string;
  stop_sequence?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    // Cache tokens (prompt caching)
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    // Ephemeral cache breakdown
    cache_creation?: {
      ephemeral_5m_input_tokens?: number;
      ephemeral_1h_input_tokens?: number;
    };
    // Service info
    service_tier?: 'standard' | 'priority' | 'batch';
  };
}

interface StreamEvent {
  type: string;
  message?: MessageResponse;
  index?: number;
  content_block?: ContentBlock;
  delta?: { type: string; text?: string; partial_json?: string };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

// ─────────────────────────────────────────────────────────────
// Provider Implementation
// ─────────────────────────────────────────────────────────────

export const PROVIDER_NAME: ProviderName = 'anthropic';

/**
 * Check if client is Anthropic SDK
 */
export function canHandle(client: unknown): boolean {
  if (!client || typeof client !== 'object') return false;

  const constructorName = client.constructor?.name;
  if (constructorName === 'Anthropic') return true;

  // Check for characteristic properties
  const c = client as Record<string, unknown>;
  return !!(c.messages && typeof c.messages === 'object');
}

/**
 * Wrap Anthropic client with tracing
 */
export function wrap(client: unknown): unknown {
  const anthropicClient = client as AnthropicClient;
  return new Proxy(anthropicClient, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'messages' && value && typeof value === 'object') {
        return wrapMessagesNamespace(value as AnthropicClient['messages']);
      }

      return value;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Namespace Wrappers
// ─────────────────────────────────────────────────────────────

function wrapMessagesNamespace(messages: AnthropicClient['messages']) {
  if (!messages) return messages;

  return new Proxy(messages, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'create' && typeof value === 'function') {
        return wrapMessagesCreate(value.bind(target));
      }

      if (prop === 'stream' && typeof value === 'function') {
        return wrapMessagesStream(value.bind(target));
      }

      return value;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Method Wrappers
// ─────────────────────────────────────────────────────────────

export function wrapMessagesCreate(originalFn: (...args: unknown[]) => Promise<unknown>) {
  return async function wrappedMessagesCreate(...args: unknown[]): Promise<unknown> {
    const startTime = Date.now();
    const request = (args[0] || {}) as MessageRequest;
    const isStreaming = request.stream === true;

    try {
      const response = await originalFn(...args);

      if (isStreaming && isAsyncIterable(response)) {
        return wrapStream(response, request, startTime);
      }

      // Non-streaming response
      const durationMs = Date.now() - startTime;
      const messageResponse = response as MessageResponse;
      const extracted = extractMessageResponse(messageResponse);

      const spanId = captureTrace({
        provider: PROVIDER_NAME,
        model: request.model || extracted.model || 'unknown',
        input: { system: request.system, messages: request.messages },
        output: extracted.output,
        inputTokens: extracted.tokens?.inputTokens || 0,
        outputTokens: extracted.tokens?.outputTokens || 0,
        durationMs,
        status: 'success',
        streaming: false,
        // Extended fields
        stopReason: extracted.stopReason || undefined,
        cacheReadTokens: extracted.tokens?.cacheReadTokens,
        cacheWriteTokens: extracted.tokens?.cacheWriteTokens,
        thinking: extracted.thinking || undefined,
      });

      // Register tool calls for hierarchy linking
      if (spanId && extracted.toolUseIds.length > 0) {
        registerToolCalls(extracted.toolUseIds, spanId);
      }

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      captureError({
        provider: PROVIDER_NAME,
        model: request.model || 'unknown',
        input: { system: request.system, messages: request.messages },
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs,
        streaming: isStreaming,
      });

      throw error;
    }
  };
}

export function wrapMessagesStream(originalFn: (...args: unknown[]) => unknown) {
  return function wrappedMessagesStream(...args: unknown[]): unknown {
    const startTime = Date.now();
    const request = (args[0] || {}) as MessageRequest;

    try {
      const stream = originalFn(...args);

      // Anthropic's stream() returns a Stream object with async iterator
      if (stream && typeof stream === 'object') {
        return wrapAnthropicStream(stream, request, startTime);
      }

      return stream;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      captureError({
        provider: PROVIDER_NAME,
        model: request.model || 'unknown',
        input: { system: request.system, messages: request.messages },
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs,
        streaming: true,
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

function wrapAnthropicStream(
  stream: unknown,
  request: MessageRequest,
  startTime: number
): unknown {
  // Anthropic SDK returns a Stream object with methods like finalMessage()
  // We need to wrap the async iterator and track events

  const originalStream = stream as {
    [Symbol.asyncIterator]?: () => AsyncIterator<StreamEvent>;
    finalMessage?: () => Promise<MessageResponse>;
  };

  if (!originalStream[Symbol.asyncIterator]) {
    return stream;
  }

  const chunks: string[] = [];
  const thinkingChunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens: number | undefined;
  let cacheWriteTokens: number | undefined;
  let stopReason: string | undefined;
  let model = request.model || 'unknown';
  let captured = false;
  let firstTokenMs: number | undefined;
  let firstTokenReceived = false;

  // Track tool_use blocks during streaming
  const toolCalls: Array<{ id: string; name: string; input: unknown; inputJson: string }> = [];
  let currentToolIndex: number | null = null;
  let currentBlockType: string | null = null;

  const wrappedIterator = async function* () {
    try {
      for await (const event of originalStream as AsyncIterable<StreamEvent>) {
        // Extract data from events
        if (event.type === 'message_start' && event.message) {
          model = event.message.model || model;
          if (event.message.usage) {
            inputTokens = event.message.usage.input_tokens || 0;
            cacheReadTokens = event.message.usage.cache_read_input_tokens;
            cacheWriteTokens = event.message.usage.cache_creation_input_tokens;
          }
        }

        // Track content block types for thinking vs text
        if (event.type === 'content_block_start' && event.content_block) {
          currentBlockType = event.content_block.type;
        }

        if (event.type === 'content_block_delta' && event.delta?.text) {
          // Measure time to first text token
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            firstTokenMs = Date.now() - startTime;
          }

          // Route to thinking or text chunks based on current block type
          if (currentBlockType === 'thinking') {
            thinkingChunks.push(event.delta.text);
          } else {
            chunks.push(event.delta.text);
          }
        }

        // Detect tool_use content block start
        if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          const block = event.content_block;
          if (block.id && block.name) {
            currentToolIndex = event.index ?? toolCalls.length;
            toolCalls.push({
              id: block.id,
              name: block.name,
              input: block.input ?? {},
              inputJson: '',
            });
          }
        }

        // Accumulate tool input JSON during streaming
        if (event.type === 'content_block_delta' && event.delta?.partial_json && currentToolIndex !== null) {
          const tool = toolCalls.find((_, i) => i === currentToolIndex);
          if (tool) {
            tool.inputJson += event.delta.partial_json;
          }
        }

        // Parse accumulated JSON when content block stops
        if (event.type === 'content_block_stop') {
          if (currentToolIndex !== null) {
            const tool = toolCalls[currentToolIndex];
            if (tool && tool.inputJson) {
              try {
                tool.input = JSON.parse(tool.inputJson);
              } catch {
                // Keep existing input if JSON parse fails
              }
            }
            currentToolIndex = null;
          }
          currentBlockType = null;
        }

        // Extract stop_reason and final tokens from message_delta
        if (event.type === 'message_delta') {
          if (event.usage) {
            outputTokens = event.usage.output_tokens || 0;
          }
          // message_delta also contains stop_reason
          const delta = event as unknown as { delta?: { stop_reason?: string } };
          if (delta.delta?.stop_reason) {
            stopReason = delta.delta.stop_reason;
          }
        }

        yield event;
      }
    } catch (error) {
      if (!captured) {
        captured = true;
        const durationMs = Date.now() - startTime;

        captureError({
          provider: PROVIDER_NAME,
          model,
          input: { system: request.system, messages: request.messages },
          error: error instanceof Error ? error : new Error(String(error)),
          durationMs,
          streaming: true,
        });
      }

      throw error;
    } finally {
      if (!captured) {
        captured = true;
        const durationMs = Date.now() - startTime;

        const spanId = captureTrace({
          provider: PROVIDER_NAME,
          model,
          input: { system: request.system, messages: request.messages },
          output: chunks.join(''),
          inputTokens,
          outputTokens,
          durationMs,
          status: 'success',
          streaming: true,
          // Extended fields
          stopReason,
          cacheReadTokens,
          cacheWriteTokens,
          firstTokenMs,
          thinking: thinkingChunks.length > 0 ? thinkingChunks.join('') : undefined,
        });

        // Register tool calls for hierarchy linking
        if (spanId && toolCalls.length > 0) {
          const toolUseIds = toolCalls.map(t => t.id);
          registerToolCalls(toolUseIds, spanId);
        }
      }
    }
  };

  // Return a proxy that preserves other methods (like finalMessage)
  return new Proxy(stream as object, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        return () => wrappedIterator()[Symbol.asyncIterator]();
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

async function* wrapStream(
  stream: AsyncIterable<unknown>,
  request: MessageRequest,
  startTime: number
): AsyncIterable<unknown> {
  const chunks: string[] = [];
  const thinkingChunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens: number | undefined;
  let cacheWriteTokens: number | undefined;
  let stopReason: string | undefined;
  let model = request.model || 'unknown';
  let error: Error | null = null;
  let firstTokenMs: number | undefined;
  let firstTokenReceived = false;

  // Track tool_use blocks during streaming
  const toolCalls: Array<{ id: string; name: string; input: unknown; inputJson: string }> = [];
  let currentToolIndex: number | null = null;
  let currentBlockType: string | null = null;

  try {
    for await (const event of stream as AsyncIterable<StreamEvent>) {
      if (event.type === 'message_start' && event.message) {
        model = event.message.model || model;
        if (event.message.usage) {
          inputTokens = event.message.usage.input_tokens || 0;
          cacheReadTokens = event.message.usage.cache_read_input_tokens;
          cacheWriteTokens = event.message.usage.cache_creation_input_tokens;
        }
      }

      // Track content block types for thinking vs text
      if (event.type === 'content_block_start' && event.content_block) {
        currentBlockType = event.content_block.type;
      }

      if (event.type === 'content_block_delta' && event.delta?.text) {
        // Measure time to first text token
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          firstTokenMs = Date.now() - startTime;
        }

        // Route to thinking or text chunks based on current block type
        if (currentBlockType === 'thinking') {
          thinkingChunks.push(event.delta.text);
        } else {
          chunks.push(event.delta.text);
        }
      }

      // Detect tool_use content block start
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        const block = event.content_block;
        if (block.id && block.name) {
          currentToolIndex = event.index ?? toolCalls.length;
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input ?? {},
            inputJson: '',
          });
        }
      }

      // Accumulate tool input JSON during streaming
      if (event.type === 'content_block_delta' && event.delta?.partial_json && currentToolIndex !== null) {
        const tool = toolCalls.find((_, i) => i === currentToolIndex);
        if (tool) {
          tool.inputJson += event.delta.partial_json;
        }
      }

      // Parse accumulated JSON when content block stops
      if (event.type === 'content_block_stop') {
        if (currentToolIndex !== null) {
          const tool = toolCalls[currentToolIndex];
          if (tool && tool.inputJson) {
            try {
              tool.input = JSON.parse(tool.inputJson);
            } catch {
              // Keep existing input if JSON parse fails
            }
          }
          currentToolIndex = null;
        }
        currentBlockType = null;
      }

      // Extract stop_reason and final tokens from message_delta
      if (event.type === 'message_delta') {
        if (event.usage) {
          outputTokens = event.usage.output_tokens || 0;
        }
        // message_delta also contains stop_reason
        const delta = event as unknown as { delta?: { stop_reason?: string } };
        if (delta.delta?.stop_reason) {
          stopReason = delta.delta.stop_reason;
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
        model,
        input: { system: request.system, messages: request.messages },
        error,
        durationMs,
        streaming: true,
      });
    } else {
      const spanId = captureTrace({
        provider: PROVIDER_NAME,
        model,
        input: { system: request.system, messages: request.messages },
        output: chunks.join(''),
        inputTokens,
        outputTokens,
        durationMs,
        status: 'success',
        streaming: true,
        // Extended fields
        stopReason,
        cacheReadTokens,
        cacheWriteTokens,
        firstTokenMs,
        thinking: thinkingChunks.length > 0 ? thinkingChunks.join('') : undefined,
      });

      // Register tool calls for hierarchy linking
      if (spanId && toolCalls.length > 0) {
        const toolUseIds = toolCalls.map(t => t.id);
        registerToolCalls(toolUseIds, spanId);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Extraction Helpers
// ─────────────────────────────────────────────────────────────

interface ExtractedResponse {
  model: string | null;
  output: string | null;
  tokens: TokenUsage | null;
  stopReason: string | null;
  thinking: string | null;
  toolUseIds: string[];
}

function extractMessageResponse(response: MessageResponse): ExtractedResponse {
  const model = safeExtract(() => response.model ?? null, null);
  const stopReason = safeExtract(() => response.stop_reason ?? null, null);

  // Extract text from content blocks
  const output = safeExtract(() => {
    if (!response.content || !Array.isArray(response.content)) return null;

    const textBlocks = response.content
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text);

    return textBlocks.join('') || null;
  }, null);

  // Extract thinking blocks (extended thinking)
  const thinking = safeExtract(() => {
    if (!response.content || !Array.isArray(response.content)) return null;

    const thinkingBlocks = response.content
      .filter((block) => block.type === 'thinking' && block.thinking)
      .map((block) => block.thinking);

    return thinkingBlocks.join('\n\n') || null;
  }, null);

  // Extract tool use IDs for hierarchy linking
  const toolUseIds: string[] = [];
  if (response.content && Array.isArray(response.content)) {
    for (const block of response.content) {
      if (block.type === 'tool_use' && block.id) {
        toolUseIds.push(block.id);
      }
    }
  }

  const tokens = extractTokens(response);

  return { model, output, tokens, stopReason, thinking, toolUseIds };
}

function extractTokens(response: MessageResponse): TokenUsage | null {
  try {
    const usage = response.usage;
    if (!usage) return null;

    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;

    if (!isValidNumber(inputTokens) && !isValidNumber(outputTokens)) {
      return null;
    }

    return {
      inputTokens: isValidNumber(inputTokens) ? inputTokens : 0,
      outputTokens: isValidNumber(outputTokens) ? outputTokens : 0,
      totalTokens: (isValidNumber(inputTokens) ? inputTokens : 0) + (isValidNumber(outputTokens) ? outputTokens : 0),
      // Cache tokens (Anthropic prompt caching)
      cacheReadTokens: isValidNumber(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : undefined,
      cacheWriteTokens: isValidNumber(usage.cache_creation_input_tokens) ? usage.cache_creation_input_tokens : undefined,
    };
  } catch {
    return null;
  }
}

