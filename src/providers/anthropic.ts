/**
 * Anthropic Provider Wrapper
 *
 * Wraps the Anthropic SDK to automatically capture LLM calls.
 * SDK thin: only captures timing and raw response.
 * Server smart: extracts tokens, output, tools, etc.
 */

import type { ProviderName } from '../core/types';
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
}

interface MessageRequest {
  model?: string;
  messages?: unknown[];
  system?: string;
  stream?: boolean;
  [key: string]: unknown;
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
}

interface UsageInfo {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface MessageResponse {
  id?: string;
  type?: string;
  role?: string;
  content?: ContentBlock[];
  model?: string;
  stop_reason?: string;
  usage?: UsageInfo;
}

interface StreamEvent {
  type: string;
  message?: MessageResponse;
  index?: number;
  content_block?: ContentBlock;
  delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string };
  usage?: UsageInfo;
}

// ─────────────────────────────────────────────────────────────
// Provider Implementation
// ─────────────────────────────────────────────────────────────

export const PROVIDER_NAME: ProviderName = 'anthropic';

export function canHandle(client: unknown): boolean {
  if (!client || typeof client !== 'object') return false;
  const constructorName = client.constructor?.name;
  if (constructorName === 'Anthropic') return true;
  const c = client as Record<string, unknown>;
  return !!(c.messages && typeof c.messages === 'object');
}

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
// Non-Streaming
// ─────────────────────────────────────────────────────────────

export function wrapMessagesCreate(originalFn: (...args: unknown[]) => Promise<unknown>) {
  return async function wrappedMessagesCreate(...args: unknown[]): Promise<unknown> {
    const startTime = Date.now();
    const request = (args[0] || {}) as MessageRequest;
    const isStreaming = request.stream === true;

    try {
      const response = await originalFn(...args);

      if (isStreaming && isAsyncIterable(response)) {
        return wrapStreamResponse(response, request, startTime);
      }

      // Non-streaming: send raw response to server
      const durationMs = Date.now() - startTime;
      const messageResponse = response as MessageResponse;

      const spanId = captureTrace({
        provider: PROVIDER_NAME,
        model: request.model || messageResponse.model || 'unknown',
        input: { system: request.system, messages: request.messages },
        rawResponse: response, // Server extracts everything
        durationMs,
        status: 'success',
        streaming: false,
      });

      // Register tool calls for hierarchy (extract IDs only)
      if (spanId && messageResponse.content) {
        const toolUseIds = extractToolUseIds(messageResponse.content);
        if (toolUseIds.length > 0) {
          registerToolCalls(toolUseIds, spanId);
        }
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

// ─────────────────────────────────────────────────────────────
// Streaming
// ─────────────────────────────────────────────────────────────

export function wrapMessagesStream(originalFn: (...args: unknown[]) => unknown) {
  return function wrappedMessagesStream(...args: unknown[]): unknown {
    const startTime = Date.now();
    const request = (args[0] || {}) as MessageRequest;

    try {
      const stream = originalFn(...args);
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

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value != null && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function';
}

// Reconstructs final response from stream events for rawResponse
function wrapAnthropicStream(
  stream: unknown,
  request: MessageRequest,
  startTime: number
): unknown {
  const originalStream = stream as {
    [Symbol.asyncIterator]?: () => AsyncIterator<StreamEvent>;
  };

  if (!originalStream[Symbol.asyncIterator]) {
    return stream;
  }

  // Accumulate to reconstruct final response
  const finalResponse: MessageResponse = {
    content: [],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  let captured = false;
  let firstTokenMs: number | undefined;
  let firstTokenReceived = false;

  // Track current content block being built
  let currentBlockIndex: number | null = null;
  const contentBlocks: ContentBlock[] = [];

  const wrappedIterator = async function* () {
    try {
      for await (const event of originalStream as AsyncIterable<StreamEvent>) {
        // message_start: get model and initial usage
        if (event.type === 'message_start' && event.message) {
          finalResponse.model = event.message.model;
          finalResponse.id = event.message.id;
          finalResponse.role = event.message.role;
          if (event.message.usage) {
            finalResponse.usage = { ...event.message.usage };
          }
        }

        // content_block_start: initialize new block
        if (event.type === 'content_block_start' && event.content_block) {
          currentBlockIndex = event.index ?? contentBlocks.length;
          contentBlocks[currentBlockIndex] = { ...event.content_block };
          if (event.content_block.type === 'text') {
            contentBlocks[currentBlockIndex].text = '';
          }
          if (event.content_block.type === 'thinking') {
            contentBlocks[currentBlockIndex].thinking = '';
          }
        }

        // content_block_delta: accumulate text/json
        if (event.type === 'content_block_delta' && event.delta && currentBlockIndex !== null) {
          const block = contentBlocks[currentBlockIndex];
          if (block) {
            if (event.delta.text) {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                firstTokenMs = Date.now() - startTime;
              }
              if (block.type === 'thinking') {
                block.thinking = (block.thinking || '') + event.delta.text;
              } else if (block.type === 'text') {
                block.text = (block.text || '') + event.delta.text;
              }
            }
            if (event.delta.partial_json && block.type === 'tool_use') {
              // Accumulate JSON for tool input
              (block as { _inputJson?: string })._inputJson =
                ((block as { _inputJson?: string })._inputJson || '') + event.delta.partial_json;
            }
          }
        }

        // content_block_stop: finalize block
        if (event.type === 'content_block_stop' && currentBlockIndex !== null) {
          const block = contentBlocks[currentBlockIndex];
          if (block && block.type === 'tool_use') {
            const inputJson = (block as { _inputJson?: string })._inputJson;
            if (inputJson) {
              try {
                block.input = JSON.parse(inputJson);
              } catch {
                // Keep existing
              }
              delete (block as { _inputJson?: string })._inputJson;
            }
          }
          currentBlockIndex = null;
        }

        // message_delta: get stop_reason and final usage
        if (event.type === 'message_delta') {
          if (event.usage?.output_tokens) {
            finalResponse.usage!.output_tokens = event.usage.output_tokens;
          }
          if (event.delta?.stop_reason) {
            finalResponse.stop_reason = event.delta.stop_reason;
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
          model: finalResponse.model || request.model || 'unknown',
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

        // Build final response object
        finalResponse.content = contentBlocks.filter(Boolean);

        const spanId = captureTrace({
          provider: PROVIDER_NAME,
          model: finalResponse.model || request.model || 'unknown',
          input: { system: request.system, messages: request.messages },
          rawResponse: finalResponse, // Reconstructed response
          durationMs,
          status: 'success',
          streaming: true,
          firstTokenMs,
        });

        // Register tool calls
        if (spanId && finalResponse.content) {
          const toolUseIds = extractToolUseIds(finalResponse.content);
          if (toolUseIds.length > 0) {
            registerToolCalls(toolUseIds, spanId);
          }
        }
      }
    }
  };

  return new Proxy(stream as object, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        return () => wrappedIterator()[Symbol.asyncIterator]();
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function* wrapStreamResponse(
  stream: AsyncIterable<unknown>,
  request: MessageRequest,
  startTime: number
): AsyncIterable<unknown> {
  const finalResponse: MessageResponse = {
    content: [],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  let error: Error | null = null;
  let firstTokenMs: number | undefined;
  let firstTokenReceived = false;
  let currentBlockIndex: number | null = null;
  const contentBlocks: ContentBlock[] = [];

  try {
    for await (const event of stream as AsyncIterable<StreamEvent>) {
      if (event.type === 'message_start' && event.message) {
        finalResponse.model = event.message.model;
        finalResponse.id = event.message.id;
        finalResponse.role = event.message.role;
        if (event.message.usage) {
          finalResponse.usage = { ...event.message.usage };
        }
      }

      if (event.type === 'content_block_start' && event.content_block) {
        currentBlockIndex = event.index ?? contentBlocks.length;
        contentBlocks[currentBlockIndex] = { ...event.content_block };
        if (event.content_block.type === 'text') {
          contentBlocks[currentBlockIndex].text = '';
        }
        if (event.content_block.type === 'thinking') {
          contentBlocks[currentBlockIndex].thinking = '';
        }
      }

      if (event.type === 'content_block_delta' && event.delta && currentBlockIndex !== null) {
        const block = contentBlocks[currentBlockIndex];
        if (block) {
          if (event.delta.text) {
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              firstTokenMs = Date.now() - startTime;
            }
            if (block.type === 'thinking') {
              block.thinking = (block.thinking || '') + event.delta.text;
            } else if (block.type === 'text') {
              block.text = (block.text || '') + event.delta.text;
            }
          }
          if (event.delta.partial_json && block.type === 'tool_use') {
            (block as { _inputJson?: string })._inputJson =
              ((block as { _inputJson?: string })._inputJson || '') + event.delta.partial_json;
          }
        }
      }

      if (event.type === 'content_block_stop' && currentBlockIndex !== null) {
        const block = contentBlocks[currentBlockIndex];
        if (block && block.type === 'tool_use') {
          const inputJson = (block as { _inputJson?: string })._inputJson;
          if (inputJson) {
            try {
              block.input = JSON.parse(inputJson);
            } catch {
              // Keep existing
            }
            delete (block as { _inputJson?: string })._inputJson;
          }
        }
        currentBlockIndex = null;
      }

      if (event.type === 'message_delta') {
        if (event.usage?.output_tokens) {
          finalResponse.usage!.output_tokens = event.usage.output_tokens;
        }
        if (event.delta?.stop_reason) {
          finalResponse.stop_reason = event.delta.stop_reason;
        }
      }

      yield event;
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
    throw err;
  } finally {
    const durationMs = Date.now() - startTime;
    finalResponse.content = contentBlocks.filter(Boolean);

    if (error) {
      captureError({
        provider: PROVIDER_NAME,
        model: finalResponse.model || request.model || 'unknown',
        input: { system: request.system, messages: request.messages },
        error,
        durationMs,
        streaming: true,
      });
    } else {
      const spanId = captureTrace({
        provider: PROVIDER_NAME,
        model: finalResponse.model || request.model || 'unknown',
        input: { system: request.system, messages: request.messages },
        rawResponse: finalResponse,
        durationMs,
        status: 'success',
        streaming: true,
        firstTokenMs,
      });

      if (spanId && finalResponse.content) {
        const toolUseIds = extractToolUseIds(finalResponse.content);
        if (toolUseIds.length > 0) {
          registerToolCalls(toolUseIds, spanId);
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function extractToolUseIds(content: ContentBlock[]): string[] {
  const ids: string[] = [];
  for (const block of content) {
    if (block.type === 'tool_use' && block.id) {
      ids.push(block.id);
    }
  }
  return ids;
}
