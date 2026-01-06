/**
 * AWS Bedrock Provider Wrapper
 *
 * Wraps @aws-sdk/client-bedrock-runtime to automatically capture:
 * - client.send(ConverseCommand)
 * - client.send(ConverseStreamCommand)
 * - client.send(InvokeModelCommand)
 * - client.send(InvokeModelWithResponseStreamCommand)
 */

import type { ProviderName, TokenUsage } from '../core/types';
import { safeExtract, isValidNumber } from './base';
import { captureTrace, captureError } from '../core/capture';
import { registerToolCalls } from '../core/context';

// ─────────────────────────────────────────────────────────────
// Types (minimal, to avoid SDK dependency)
// ─────────────────────────────────────────────────────────────

interface BedrockClient {
  send: (command: BedrockCommand) => Promise<unknown>;
  config?: { region?: string | (() => Promise<string>) };
}

interface BedrockCommand {
  constructor: { name: string };
  input: unknown;
}

interface ConverseInput {
  modelId: string;
  messages?: Array<{ role: string; content: Array<{ text?: string }> }>;
  system?: Array<{ text?: string }>;
  inferenceConfig?: Record<string, unknown>;
  toolConfig?: Record<string, unknown>;
  guardrailConfig?: Record<string, unknown>;
  performanceConfig?: { latency?: string };
  requestMetadata?: Record<string, string>;
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
  $metadata: { httpStatusCode: number };
  output?: {
    message?: { role: string; content: ContentBlock[] };
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
  };
  stopReason?: string;
  metrics?: { latencyMs?: number };
}

interface ConverseStreamResponse {
  $metadata: { httpStatusCode: number };
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
  contentType?: string;
}

interface InvokeModelResponse {
  $metadata: { httpStatusCode: number };
  body: Uint8Array;
  contentType?: string;
}

interface InvokeModelStreamResponse {
  $metadata: { httpStatusCode: number };
  body?: AsyncIterable<{ chunk?: { bytes?: Uint8Array } }>;
}

// ─────────────────────────────────────────────────────────────
// Provider Implementation
// ─────────────────────────────────────────────────────────────

export const PROVIDER_NAME: ProviderName = 'bedrock';

/**
 * Check if client is BedrockRuntimeClient
 */
export function canHandle(client: unknown): boolean {
  if (!client || typeof client !== 'object') return false;

  const constructorName = client.constructor?.name;
  if (constructorName === 'BedrockRuntimeClient') return true;

  // Check by shape: has send() and config.region
  const c = client as Record<string, unknown>;
  if (typeof c.send !== 'function') return false;
  if (!c.config || typeof c.config !== 'object') return false;

  return 'region' in (c.config as Record<string, unknown>);
}

/**
 * Wrap BedrockRuntimeClient with tracing
 */
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

// ─────────────────────────────────────────────────────────────
// Send Wrapper
// ─────────────────────────────────────────────────────────────

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
        // Pass through non-LLM commands (e.g., ListFoundationModels)
        return originalSend(command);
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Converse API Handlers
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
    const extracted = extractConverseOutput(response);

    const spanId = captureTrace({
      provider: PROVIDER_NAME,
      model: input.modelId || 'unknown',
      input: { system: input.system, messages: input.messages },
      output: extracted.output,
      inputTokens: extracted.inputTokens,
      outputTokens: extracted.outputTokens,
      durationMs,
      status: 'success',
      streaming: false,
      // Extended fields (Phase 7.1)
      stopReason: response.stopReason,
      cacheReadTokens: extracted.cacheReadTokens,
      cacheWriteTokens: extracted.cacheWriteTokens,
      metadata: {
        hasToolUse: extracted.hasToolUse,
        latencyMs: response.metrics?.latencyMs,
      },
    });

    // Register tool calls for hierarchy linking
    if (spanId && extracted.toolUseIds.length > 0) {
      registerToolCalls(extracted.toolUseIds, spanId);
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
  const chunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let error: Error | null = null;
  let stopReason: string | undefined;
  let firstTokenMs: number | undefined;
  let firstContentReceived = false;

  // Track toolUse blocks during streaming
  const toolCalls: Map<number, { id: string; name: string; inputJson: string }> = new Map();

  try {
    for await (const event of stream) {
      // Track time to first content token
      if (event.contentBlockDelta?.delta?.text && !firstContentReceived) {
        firstContentReceived = true;
        firstTokenMs = Date.now() - startTime;
        chunks.push(event.contentBlockDelta.delta.text);
      } else if (event.contentBlockDelta?.delta?.text) {
        chunks.push(event.contentBlockDelta.delta.text);
      }

      // Detect toolUse content block start
      if (event.contentBlockStart?.start?.toolUse) {
        const tool = event.contentBlockStart.start.toolUse;
        toolCalls.set(event.contentBlockStart.contentBlockIndex, {
          id: tool.toolUseId,
          name: tool.name,
          inputJson: '',
        });
      }

      // Accumulate tool input JSON during streaming
      if (event.contentBlockDelta?.delta?.toolUse?.input) {
        const tool = toolCalls.get(event.contentBlockDelta.contentBlockIndex);
        if (tool) {
          tool.inputJson += event.contentBlockDelta.delta.toolUse.input;
        }
      }

      // Capture stop reason
      if (event.messageStop?.stopReason) {
        stopReason = event.messageStop.stopReason;
      }

      if (event.metadata?.usage) {
        inputTokens = event.metadata.usage.inputTokens || 0;
        outputTokens = event.metadata.usage.outputTokens || 0;
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
        output: chunks.join(''),
        inputTokens,
        outputTokens,
        durationMs,
        status: 'success',
        streaming: true,
        // Extended fields (Phase 7.1)
        stopReason,
        firstTokenMs,
      });

      // Register tool calls for hierarchy linking
      if (spanId && toolCalls.size > 0) {
        const toolUseIds = Array.from(toolCalls.values()).map(t => t.id);
        registerToolCalls(toolUseIds, spanId);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// InvokeModel API Handlers
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
    const parsed = parseInvokeModelBody(response.body);

    captureTrace({
      provider: PROVIDER_NAME,
      model: input.modelId || 'unknown',
      input: parseRequestBody(input.body),
      output: parsed.output,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
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
  const chunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let error: Error | null = null;

  try {
    for await (const event of stream) {
      if (event.chunk?.bytes) {
        const parsed = tryParseStreamChunk(event.chunk.bytes);
        if (parsed) {
          if (parsed.text) chunks.push(parsed.text);
          if (parsed.inputTokens) inputTokens = parsed.inputTokens;
          if (parsed.outputTokens) outputTokens = parsed.outputTokens;
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
        model: input.modelId || 'unknown',
        input: parseRequestBody(input.body),
        error,
        durationMs,
        streaming: true,
      });
    } else {
      captureTrace({
        provider: PROVIDER_NAME,
        model: input.modelId || 'unknown',
        input: parseRequestBody(input.body),
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

// ─────────────────────────────────────────────────────────────
// Extraction Helpers
// ─────────────────────────────────────────────────────────────

function extractConverseOutput(response: ConverseResponse): {
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  hasToolUse: boolean;
  toolUseIds: string[];
} {
  const content = response.output?.message?.content;
  const hasToolUse = Array.isArray(content) && content.some((c) => c.toolUse);

  // Extract tool use IDs for hierarchy linking
  const toolUseIds: string[] = [];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.toolUse?.toolUseId) {
        toolUseIds.push(block.toolUse.toolUseId);
      }
    }
  }

  const output = safeExtract(() => {
    if (!Array.isArray(content)) return null;
    // If there's tool use, return the full content structure
    if (hasToolUse) {
      return content;
    }
    // Otherwise, join text content
    return content.map((c) => c.text || '').join('');
  }, null);

  const usage = response.usage || {};

  return {
    output,
    inputTokens: isValidNumber(usage.inputTokens) ? usage.inputTokens! : 0,
    outputTokens: isValidNumber(usage.outputTokens) ? usage.outputTokens! : 0,
    cacheReadTokens: isValidNumber(usage.cacheReadInputTokens) ? usage.cacheReadInputTokens! : 0,
    cacheWriteTokens: isValidNumber(usage.cacheWriteInputTokens) ? usage.cacheWriteInputTokens! : 0,
    hasToolUse,
    toolUseIds,
  };
}


function parseInvokeModelBody(body: Uint8Array): {
  output: unknown;
  inputTokens: number;
  outputTokens: number;
} {
  try {
    const text = new TextDecoder().decode(body);
    const parsed = JSON.parse(text);

    // Claude on Bedrock
    if (parsed.content && Array.isArray(parsed.content)) {
      const output = parsed.content
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { text?: string }) => c.text || '')
        .join('');
      return {
        output,
        inputTokens: parsed.usage?.input_tokens || 0,
        outputTokens: parsed.usage?.output_tokens || 0,
      };
    }

    // Amazon Titan
    if (parsed.results) {
      return {
        output: parsed.results[0]?.outputText || parsed.results,
        inputTokens: parsed.inputTextTokenCount || 0,
        outputTokens: parsed.results[0]?.tokenCount || 0,
      };
    }

    // Meta Llama
    if (parsed.generation) {
      return {
        output: parsed.generation,
        inputTokens: parsed.prompt_token_count || 0,
        outputTokens: parsed.generation_token_count || 0,
      };
    }

    return { output: parsed, inputTokens: 0, outputTokens: 0 };
  } catch {
    return { output: null, inputTokens: 0, outputTokens: 0 };
  }
}

function parseRequestBody(body: Uint8Array | string): unknown {
  try {
    const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
    return JSON.parse(text);
  } catch {
    return body;
  }
}

function tryParseStreamChunk(bytes: Uint8Array): {
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
} | null {
  try {
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text);

    // Claude streaming format
    if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
      return { text: parsed.delta.text };
    }
    if (parsed.type === 'message_delta' && parsed.usage) {
      return { outputTokens: parsed.usage.output_tokens };
    }
    if (parsed.type === 'message_start' && parsed.message?.usage) {
      return { inputTokens: parsed.message.usage.input_tokens };
    }

    return null;
  } catch {
    return null;
  }
}
