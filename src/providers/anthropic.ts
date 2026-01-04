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
import { captureTrace, captureError, captureToolSpans } from '../core/capture';

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
}

interface MessageResponse {
  id?: string;
  type?: string;
  role?: string;
  content?: ContentBlock[];
  model?: string;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
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

      captureTrace({
        provider: PROVIDER_NAME,
        model: request.model || extracted.model || 'unknown',
        input: { system: request.system, messages: request.messages },
        output: extracted.output,
        inputTokens: extracted.tokens?.inputTokens || 0,
        outputTokens: extracted.tokens?.outputTokens || 0,
        durationMs,
        status: 'success',
        streaming: false,
      });

      // Auto-detect tool_use in response and create separate tool spans
      const toolCalls = extractToolCalls(messageResponse);
      if (toolCalls.length > 0) {
        captureToolSpans(toolCalls, PROVIDER_NAME);
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
  let inputTokens = 0;
  let outputTokens = 0;
  let model = request.model || 'unknown';
  let captured = false;

  // Track tool_use blocks during streaming
  const toolCalls: Array<{ id: string; name: string; input: unknown; inputJson: string }> = [];
  let currentToolIndex: number | null = null;

  const wrappedIterator = async function* () {
    try {
      for await (const event of originalStream as AsyncIterable<StreamEvent>) {
        // Extract data from events
        if (event.type === 'message_start' && event.message) {
          model = event.message.model || model;
          if (event.message.usage) {
            inputTokens = event.message.usage.input_tokens || 0;
          }
        }

        if (event.type === 'content_block_delta' && event.delta?.text) {
          chunks.push(event.delta.text);
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
        if (event.type === 'content_block_stop' && currentToolIndex !== null) {
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

        if (event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens || 0;
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

        captureTrace({
          provider: PROVIDER_NAME,
          model,
          input: { system: request.system, messages: request.messages },
          output: chunks.join(''),
          inputTokens,
          outputTokens,
          durationMs,
          status: 'success',
          streaming: true,
        });

        // Capture tool spans detected during streaming
        if (toolCalls.length > 0) {
          captureToolSpans(
            toolCalls.map((t) => ({ id: t.id, name: t.name, input: t.input })),
            PROVIDER_NAME
          );
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
  let inputTokens = 0;
  let outputTokens = 0;
  let model = request.model || 'unknown';
  let error: Error | null = null;

  // Track tool_use blocks during streaming
  const toolCalls: Array<{ id: string; name: string; input: unknown; inputJson: string }> = [];
  let currentToolIndex: number | null = null;

  try {
    for await (const event of stream as AsyncIterable<StreamEvent>) {
      if (event.type === 'message_start' && event.message) {
        model = event.message.model || model;
        if (event.message.usage) {
          inputTokens = event.message.usage.input_tokens || 0;
        }
      }

      if (event.type === 'content_block_delta' && event.delta?.text) {
        chunks.push(event.delta.text);
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
      if (event.type === 'content_block_stop' && currentToolIndex !== null) {
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

      if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens || 0;
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
      captureTrace({
        provider: PROVIDER_NAME,
        model,
        input: { system: request.system, messages: request.messages },
        output: chunks.join(''),
        inputTokens,
        outputTokens,
        durationMs,
        status: 'success',
        streaming: true,
      });

      // Capture tool spans detected during streaming
      if (toolCalls.length > 0) {
        captureToolSpans(
          toolCalls.map((t) => ({ id: t.id, name: t.name, input: t.input })),
          PROVIDER_NAME
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Extraction Helpers
// ─────────────────────────────────────────────────────────────

function extractMessageResponse(response: MessageResponse): {
  model: string | null;
  output: string | null;
  tokens: TokenUsage | null;
} {
  const model = safeExtract(() => response.model ?? null, null);

  // Extract text from content blocks
  const output = safeExtract(() => {
    if (!response.content || !Array.isArray(response.content)) return null;

    const textBlocks = response.content
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text);

    return textBlocks.join('') || null;
  }, null);

  const tokens = extractTokens(response);

  return { model, output, tokens };
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
    };
  } catch {
    return null;
  }
}

/**
 * Extract tool_use blocks from Anthropic response
 * Returns array of tool calls for captureToolSpans
 */
function extractToolCalls(response: MessageResponse): Array<{ id: string; name: string; input: unknown }> {
  try {
    if (!response.content || !Array.isArray(response.content)) {
      return [];
    }

    return response.content
      .filter((block): block is ContentBlock & { id: string; name: string } =>
        block.type === 'tool_use' && !!block.id && !!block.name
      )
      .map((block) => ({
        id: block.id,
        name: block.name,
        input: block.input ?? {},
      }));
  } catch {
    return [];
  }
}
