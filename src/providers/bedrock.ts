/**
 * AWS Bedrock Provider Wrapper
 *
 * Wraps @aws-sdk/client-bedrock-runtime to automatically capture LLM calls.
 * SDK thin: only captures timing and raw response.
 * Server smart: extracts tokens, output, tools, etc.
 */

import type { ProviderName } from '../core/types';
import { captureTrace, captureError } from '../core/capture';
import { registerToolCalls } from '../core/context';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface BedrockClient {
  send: (command: BedrockCommand) => Promise<unknown>;
}

interface BedrockCommand {
  constructor: { name: string };
  input: unknown;
}

interface ConverseInput {
  modelId: string;
  messages?: unknown[];
  system?: unknown[];
}

interface ToolUseBlock {
  toolUseId: string;
  name: string;
  input: unknown;
}

interface ContentBlock {
  text?: string;
  toolUse?: ToolUseBlock;
}

interface ConverseResponse {
  output?: {
    message?: { role: string; content: ContentBlock[] };
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
  };
  stopReason?: string;
}

interface ConverseStreamResponse {
  stream?: AsyncIterable<ConverseStreamEvent>;
}

interface ConverseStreamEvent {
  messageStart?: { role: string };
  contentBlockStart?: {
    contentBlockIndex: number;
    start?: { toolUse?: { toolUseId: string; name: string } };
  };
  contentBlockDelta?: {
    contentBlockIndex: number;
    delta?: { text?: string; toolUse?: { input?: string } };
  };
  contentBlockStop?: { contentBlockIndex: number };
  messageStop?: { stopReason?: string };
  metadata?: { usage?: { inputTokens?: number; outputTokens?: number } };
}

interface InvokeModelInput {
  modelId: string;
  body: Uint8Array | string;
}

interface InvokeModelResponse {
  body: Uint8Array;
}

interface InvokeModelStreamResponse {
  body?: AsyncIterable<{ chunk?: { bytes?: Uint8Array } }>;
}

// ─────────────────────────────────────────────────────────────
// Provider Implementation
// ─────────────────────────────────────────────────────────────

export const PROVIDER_NAME: ProviderName = 'bedrock';

export function canHandle(client: unknown): boolean {
  if (!client || typeof client !== 'object') return false;
  const constructorName = client.constructor?.name;
  if (constructorName === 'BedrockRuntimeClient') return true;
  const c = client as Record<string, unknown>;
  if (typeof c.send !== 'function') return false;
  if (!c.config || typeof c.config !== 'object') return false;
  return 'region' in (c.config as Record<string, unknown>);
}

export function wrap(client: unknown): unknown {
  const bedrockClient = client as BedrockClient;
  return new Proxy(bedrockClient, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'send' && typeof value === 'function') {
        return wrapSend(value.bind(target));
      }
      return value;
    },
  });
}

function wrapSend(originalSend: (cmd: BedrockCommand) => Promise<unknown>) {
  return async function tracedSend(command: BedrockCommand): Promise<unknown> {
    const commandName = command.constructor?.name || '';
    switch (commandName) {
      case 'ConverseCommand':
        return handleConverse(originalSend, command);
      case 'ConverseStreamCommand':
        return handleConverseStream(originalSend, command);
      case 'InvokeModelCommand':
        return handleInvokeModel(originalSend, command);
      case 'InvokeModelWithResponseStreamCommand':
        return handleInvokeModelStream(originalSend, command);
      default:
        return originalSend(command);
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Converse API
// ─────────────────────────────────────────────────────────────

async function handleConverse(
  send: (cmd: BedrockCommand) => Promise<unknown>,
  command: BedrockCommand
): Promise<unknown> {
  const startTime = Date.now();
  const input = command.input as ConverseInput;

  try {
    const response = (await send(command)) as ConverseResponse;
    const durationMs = Date.now() - startTime;

    const spanId = captureTrace({
      provider: PROVIDER_NAME,
      model: input.modelId || 'unknown',
      input: { system: input.system, messages: input.messages },
      rawResponse: response, // Server extracts everything
      durationMs,
      status: 'success',
      streaming: false,
    });

    // Register tool calls for hierarchy
    if (spanId) {
      const toolUseIds = extractToolUseIds(response);
      if (toolUseIds.length > 0) {
        registerToolCalls(toolUseIds, spanId);
      }
    }

    return response;
  } catch (error) {
    captureError({
      provider: PROVIDER_NAME,
      model: input.modelId || 'unknown',
      input: { system: input.system, messages: input.messages },
      error: error instanceof Error ? error : new Error(String(error)),
      durationMs: Date.now() - startTime,
      streaming: false,
    });
    throw error;
  }
}

async function handleConverseStream(
  send: (cmd: BedrockCommand) => Promise<unknown>,
  command: BedrockCommand
): Promise<unknown> {
  const startTime = Date.now();
  const input = command.input as ConverseInput;

  try {
    const response = (await send(command)) as ConverseStreamResponse;
    if (response.stream) {
      return {
        ...response,
        stream: wrapConverseStream(response.stream, input, startTime),
      };
    }
    return response;
  } catch (error) {
    captureError({
      provider: PROVIDER_NAME,
      model: input.modelId || 'unknown',
      input: { system: input.system, messages: input.messages },
      error: error instanceof Error ? error : new Error(String(error)),
      durationMs: Date.now() - startTime,
      streaming: true,
    });
    throw error;
  }
}

async function* wrapConverseStream(
  stream: AsyncIterable<ConverseStreamEvent>,
  input: ConverseInput,
  startTime: number
): AsyncIterable<ConverseStreamEvent> {
  // Reconstruct response object
  const finalResponse: ConverseResponse = {
    output: { message: { role: 'assistant', content: [] } },
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  let error: Error | null = null;
  let firstTokenMs: number | undefined;
  let firstTokenReceived = false;

  // Track content blocks
  const contentBlocks: Map<number, ContentBlock> = new Map();
  const toolInputJson: Map<number, string> = new Map();

  try {
    for await (const event of stream) {
      // contentBlockStart
      if (event.contentBlockStart) {
        const idx = event.contentBlockStart.contentBlockIndex;
        if (event.contentBlockStart.start?.toolUse) {
          const tu = event.contentBlockStart.start.toolUse;
          contentBlocks.set(idx, {
            toolUse: { toolUseId: tu.toolUseId, name: tu.name, input: {} },
          });
          toolInputJson.set(idx, '');
        } else {
          contentBlocks.set(idx, { text: '' });
        }
      }

      // contentBlockDelta
      if (event.contentBlockDelta) {
        const idx = event.contentBlockDelta.contentBlockIndex;
        const block = contentBlocks.get(idx);
        if (block && event.contentBlockDelta.delta?.text) {
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            firstTokenMs = Date.now() - startTime;
          }
          block.text = (block.text || '') + event.contentBlockDelta.delta.text;
        }
        if (block?.toolUse && event.contentBlockDelta.delta?.toolUse?.input) {
          const json = toolInputJson.get(idx) || '';
          toolInputJson.set(idx, json + event.contentBlockDelta.delta.toolUse.input);
        }
      }

      // contentBlockStop - finalize tool input
      if (event.contentBlockStop) {
        const idx = event.contentBlockStop.contentBlockIndex;
        const block = contentBlocks.get(idx);
        const json = toolInputJson.get(idx);
        if (block?.toolUse && json) {
          try {
            block.toolUse.input = JSON.parse(json);
          } catch {
            // Keep empty
          }
        }
      }

      // messageStop
      if (event.messageStop?.stopReason) {
        finalResponse.stopReason = event.messageStop.stopReason;
      }

      // metadata (usage)
      if (event.metadata?.usage) {
        finalResponse.usage = {
          inputTokens: event.metadata.usage.inputTokens || 0,
          outputTokens: event.metadata.usage.outputTokens || 0,
        };
      }

      yield event;
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
    throw err;
  } finally {
    const durationMs = Date.now() - startTime;

    // Build final content array
    const sortedBlocks = Array.from(contentBlocks.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, block]) => block);
    finalResponse.output!.message!.content = sortedBlocks;

    if (error) {
      captureError({
        provider: PROVIDER_NAME,
        model: input.modelId || 'unknown',
        input: { system: input.system, messages: input.messages },
        error,
        durationMs,
        streaming: true,
      });
    } else {
      const spanId = captureTrace({
        provider: PROVIDER_NAME,
        model: input.modelId || 'unknown',
        input: { system: input.system, messages: input.messages },
        rawResponse: finalResponse,
        durationMs,
        status: 'success',
        streaming: true,
        firstTokenMs,
      });

      if (spanId) {
        const toolUseIds = extractToolUseIds(finalResponse);
        if (toolUseIds.length > 0) {
          registerToolCalls(toolUseIds, spanId);
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// InvokeModel API (legacy, raw format)
// ─────────────────────────────────────────────────────────────

async function handleInvokeModel(
  send: (cmd: BedrockCommand) => Promise<unknown>,
  command: BedrockCommand
): Promise<unknown> {
  const startTime = Date.now();
  const input = command.input as InvokeModelInput;

  try {
    const response = (await send(command)) as InvokeModelResponse;
    const durationMs = Date.now() - startTime;
    const parsedBody = parseResponseBody(response.body);

    captureTrace({
      provider: PROVIDER_NAME,
      model: input.modelId || 'unknown',
      input: parseRequestBody(input.body),
      rawResponse: parsedBody, // Parsed JSON body
      durationMs,
      status: 'success',
      streaming: false,
    });

    return response;
  } catch (error) {
    captureError({
      provider: PROVIDER_NAME,
      model: input.modelId || 'unknown',
      input: parseRequestBody(input.body),
      error: error instanceof Error ? error : new Error(String(error)),
      durationMs: Date.now() - startTime,
      streaming: false,
    });
    throw error;
  }
}

async function handleInvokeModelStream(
  send: (cmd: BedrockCommand) => Promise<unknown>,
  command: BedrockCommand
): Promise<unknown> {
  const startTime = Date.now();
  const input = command.input as InvokeModelInput;

  try {
    const response = (await send(command)) as InvokeModelStreamResponse;
    if (response.body) {
      return {
        ...response,
        body: wrapInvokeModelStream(response.body, input, startTime),
      };
    }
    return response;
  } catch (error) {
    captureError({
      provider: PROVIDER_NAME,
      model: input.modelId || 'unknown',
      input: parseRequestBody(input.body),
      error: error instanceof Error ? error : new Error(String(error)),
      durationMs: Date.now() - startTime,
      streaming: true,
    });
    throw error;
  }
}

async function* wrapInvokeModelStream(
  stream: AsyncIterable<{ chunk?: { bytes?: Uint8Array } }>,
  input: InvokeModelInput,
  startTime: number
): AsyncIterable<{ chunk?: { bytes?: Uint8Array } }> {
  // Accumulate all chunks to build response
  const allChunks: unknown[] = [];
  let error: Error | null = null;

  try {
    for await (const event of stream) {
      if (event.chunk?.bytes) {
        const parsed = tryParseChunk(event.chunk.bytes);
        if (parsed) allChunks.push(parsed);
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
        model: input.modelId || 'unknown',
        input: parseRequestBody(input.body),
        error,
        durationMs,
        streaming: true,
      });
    } else {
      // Build accumulated response for server to parse
      captureTrace({
        provider: PROVIDER_NAME,
        model: input.modelId || 'unknown',
        input: parseRequestBody(input.body),
        rawResponse: { streamEvents: allChunks },
        durationMs,
        status: 'success',
        streaming: true,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function extractToolUseIds(response: ConverseResponse): string[] {
  const ids: string[] = [];
  const content = response.output?.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.toolUse?.toolUseId) {
        ids.push(block.toolUse.toolUseId);
      }
    }
  }
  return ids;
}

function parseRequestBody(body: Uint8Array | string): unknown {
  try {
    const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
    return JSON.parse(text);
  } catch {
    return body;
  }
}

function parseResponseBody(body: Uint8Array): unknown {
  try {
    const text = new TextDecoder().decode(body);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tryParseChunk(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
  } catch {
    return null;
  }
}
