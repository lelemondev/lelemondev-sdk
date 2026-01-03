/**
 * Google Gemini Provider Wrapper
 *
 * Wraps @google/generative-ai to automatically capture:
 * - model.generateContent()
 * - model.generateContentStream()
 * - chat.sendMessage()
 * - chat.sendMessageStream()
 *
 * Supports both GoogleGenerativeAI (@google/generative-ai)
 * and GoogleGenAI (@google/genai) clients.
 */

import type { ProviderName, TokenUsage } from '../core/types';
import { safeExtract, isValidNumber } from './base';
import { captureTrace, captureError } from '../core/capture';

// ─────────────────────────────────────────────────────────────
// Types (minimal, to avoid SDK dependency)
// ─────────────────────────────────────────────────────────────

interface GeminiClient {
  getGenerativeModel: (config: ModelConfig) => GenerativeModel;
  apiKey?: string;
}

interface ModelConfig {
  model: string;
  systemInstruction?: string;
  generationConfig?: GenerationConfig;
  [key: string]: unknown;
}

interface GenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  responseSchema?: unknown;
  [key: string]: unknown;
}

interface GenerativeModel {
  generateContent: (request: GenerateContentRequest | string) => Promise<GenerateContentResult>;
  generateContentStream: (request: GenerateContentRequest | string) => Promise<StreamGenerateContentResult>;
  startChat: (config?: ChatConfig) => ChatSession;
  model: string;
}

interface GenerateContentRequest {
  contents?: Content[];
  systemInstruction?: string | Content;
  generationConfig?: GenerationConfig;
  [key: string]: unknown;
}

interface Content {
  role?: string;
  parts: Part[];
}

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  [key: string]: unknown;
}

interface GenerateContentResult {
  response: GenerateContentResponse;
}

interface StreamGenerateContentResult {
  stream: AsyncIterable<GenerateContentStreamChunk>;
  response: Promise<GenerateContentResponse>;
}

interface GenerateContentResponse {
  text: () => string;
  candidates?: Candidate[];
  usageMetadata?: UsageMetadata;
}

interface GenerateContentStreamChunk {
  text: () => string;
  candidates?: Candidate[];
  usageMetadata?: UsageMetadata;
}

interface Candidate {
  content?: Content;
  finishReason?: string;
}

interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
}

interface ChatConfig {
  history?: Content[];
  systemInstruction?: string | Content;
  generationConfig?: GenerationConfig;
  [key: string]: unknown;
}

interface ChatSession {
  sendMessage: (request: string | Part[]) => Promise<GenerateContentResult>;
  sendMessageStream: (request: string | Part[]) => Promise<StreamGenerateContentResult>;
  getHistory: () => Promise<Content[]>;
}

// ─────────────────────────────────────────────────────────────
// Provider Implementation
// ─────────────────────────────────────────────────────────────

export const PROVIDER_NAME: ProviderName = 'gemini';

/**
 * Check if client is GoogleGenerativeAI or GoogleGenAI
 */
export function canHandle(client: unknown): boolean {
  if (!client || typeof client !== 'object') return false;

  const constructorName = client.constructor?.name;

  // @google/generative-ai
  if (constructorName === 'GoogleGenerativeAI') return true;

  // @google/genai
  if (constructorName === 'GoogleGenAI') return true;

  // Check by shape: has getGenerativeModel
  const c = client as Record<string, unknown>;
  if (typeof c.getGenerativeModel === 'function') return true;

  // @google/genai has models.generate
  if (c.models && typeof (c.models as Record<string, unknown>).generate === 'function') {
    return true;
  }

  return false;
}

/**
 * Wrap Gemini client with tracing
 */
export function wrap(client: unknown): unknown {
  const geminiClient = client as GeminiClient;

  return new Proxy(geminiClient, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'getGenerativeModel' && typeof value === 'function') {
        return wrapGetGenerativeModel(value.bind(target));
      }

      return value;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Model Wrapper
// ─────────────────────────────────────────────────────────────

function wrapGetGenerativeModel(
  originalFn: (config: ModelConfig) => GenerativeModel
): (config: ModelConfig) => GenerativeModel {
  return function wrappedGetGenerativeModel(config: ModelConfig): GenerativeModel {
    const model = originalFn(config);
    return wrapGenerativeModel(model, config.model);
  };
}

function wrapGenerativeModel(model: GenerativeModel, modelName: string): GenerativeModel {
  return new Proxy(model, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'generateContent' && typeof value === 'function') {
        return wrapGenerateContent(value.bind(target), modelName);
      }

      if (prop === 'generateContentStream' && typeof value === 'function') {
        return wrapGenerateContentStream(value.bind(target), modelName);
      }

      if (prop === 'startChat' && typeof value === 'function') {
        return wrapStartChat(value.bind(target), modelName);
      }

      return value;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// generateContent Wrapper
// ─────────────────────────────────────────────────────────────

function wrapGenerateContent(
  originalFn: (request: GenerateContentRequest | string) => Promise<GenerateContentResult>,
  modelName: string
) {
  return async function wrappedGenerateContent(
    request: GenerateContentRequest | string
  ): Promise<GenerateContentResult> {
    const startTime = Date.now();
    const input = extractInput(request);

    try {
      const result = await originalFn(request);
      const durationMs = Date.now() - startTime;
      const extracted = extractGenerateContentResult(result);

      captureTrace({
        provider: PROVIDER_NAME,
        model: modelName,
        input,
        output: extracted.output,
        inputTokens: extracted.inputTokens,
        outputTokens: extracted.outputTokens,
        durationMs,
        status: 'success',
        streaming: false,
        metadata: extracted.metadata,
      });

      return result;
    } catch (error) {
      captureError({
        provider: PROVIDER_NAME,
        model: modelName,
        input,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs: Date.now() - startTime,
        streaming: false,
      });
      throw error;
    }
  };
}

// ─────────────────────────────────────────────────────────────
// generateContentStream Wrapper
// ─────────────────────────────────────────────────────────────

function wrapGenerateContentStream(
  originalFn: (request: GenerateContentRequest | string) => Promise<StreamGenerateContentResult>,
  modelName: string
) {
  return async function wrappedGenerateContentStream(
    request: GenerateContentRequest | string
  ): Promise<StreamGenerateContentResult> {
    const startTime = Date.now();
    const input = extractInput(request);

    try {
      const result = await originalFn(request);

      // Wrap the stream to capture content
      const wrappedStream = wrapStream(result.stream, modelName, input, startTime);

      return {
        ...result,
        stream: wrappedStream,
      };
    } catch (error) {
      captureError({
        provider: PROVIDER_NAME,
        model: modelName,
        input,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs: Date.now() - startTime,
        streaming: true,
      });
      throw error;
    }
  };
}

async function* wrapStream(
  stream: AsyncIterable<GenerateContentStreamChunk>,
  modelName: string,
  input: unknown,
  startTime: number
): AsyncIterable<GenerateContentStreamChunk> {
  const chunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let thoughtsTokens = 0;
  let error: Error | null = null;

  try {
    for await (const chunk of stream) {
      // Extract text from chunk
      try {
        const text = chunk.text();
        if (text) {
          chunks.push(text);
        }
      } catch {
        // text() may throw if no text content
      }

      // Extract tokens from final chunk
      if (chunk.usageMetadata) {
        inputTokens = chunk.usageMetadata.promptTokenCount || 0;
        outputTokens = chunk.usageMetadata.candidatesTokenCount || 0;
        cachedTokens = chunk.usageMetadata.cachedContentTokenCount || 0;
        thoughtsTokens = chunk.usageMetadata.thoughtsTokenCount || 0;
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
        model: modelName,
        input,
        error,
        durationMs,
        streaming: true,
      });
    } else {
      captureTrace({
        provider: PROVIDER_NAME,
        model: modelName,
        input,
        output: chunks.join(''),
        inputTokens,
        outputTokens,
        durationMs,
        status: 'success',
        streaming: true,
        metadata: {
          cachedTokens: cachedTokens > 0 ? cachedTokens : undefined,
          thoughtsTokens: thoughtsTokens > 0 ? thoughtsTokens : undefined,
        },
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Chat Wrapper
// ─────────────────────────────────────────────────────────────

function wrapStartChat(
  originalFn: (config?: ChatConfig) => ChatSession,
  modelName: string
): (config?: ChatConfig) => ChatSession {
  return function wrappedStartChat(config?: ChatConfig): ChatSession {
    const chat = originalFn(config);
    return wrapChatSession(chat, modelName);
  };
}

function wrapChatSession(chat: ChatSession, modelName: string): ChatSession {
  return new Proxy(chat, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'sendMessage' && typeof value === 'function') {
        return wrapSendMessage(value.bind(target), modelName);
      }

      if (prop === 'sendMessageStream' && typeof value === 'function') {
        return wrapSendMessageStream(value.bind(target), modelName);
      }

      return value;
    },
  });
}

function wrapSendMessage(
  originalFn: (request: string | Part[]) => Promise<GenerateContentResult>,
  modelName: string
) {
  return async function wrappedSendMessage(
    request: string | Part[]
  ): Promise<GenerateContentResult> {
    const startTime = Date.now();
    const input = typeof request === 'string' ? request : request;

    try {
      const result = await originalFn(request);
      const durationMs = Date.now() - startTime;
      const extracted = extractGenerateContentResult(result);

      captureTrace({
        provider: PROVIDER_NAME,
        model: modelName,
        input,
        output: extracted.output,
        inputTokens: extracted.inputTokens,
        outputTokens: extracted.outputTokens,
        durationMs,
        status: 'success',
        streaming: false,
        metadata: extracted.metadata,
      });

      return result;
    } catch (error) {
      captureError({
        provider: PROVIDER_NAME,
        model: modelName,
        input,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs: Date.now() - startTime,
        streaming: false,
      });
      throw error;
    }
  };
}

function wrapSendMessageStream(
  originalFn: (request: string | Part[]) => Promise<StreamGenerateContentResult>,
  modelName: string
) {
  return async function wrappedSendMessageStream(
    request: string | Part[]
  ): Promise<StreamGenerateContentResult> {
    const startTime = Date.now();
    const input = typeof request === 'string' ? request : request;

    try {
      const result = await originalFn(request);
      const wrappedStream = wrapStream(result.stream, modelName, input, startTime);

      return {
        ...result,
        stream: wrappedStream,
      };
    } catch (error) {
      captureError({
        provider: PROVIDER_NAME,
        model: modelName,
        input,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs: Date.now() - startTime,
        streaming: true,
      });
      throw error;
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Extraction Helpers
// ─────────────────────────────────────────────────────────────

function extractInput(request: GenerateContentRequest | string): unknown {
  if (typeof request === 'string') {
    return request;
  }

  // Extract contents (messages)
  if (request.contents) {
    return request.contents;
  }

  return request;
}

function extractGenerateContentResult(result: GenerateContentResult): {
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  metadata: Record<string, unknown>;
} {
  const response = result.response;

  // Extract text output
  let output: unknown = null;
  try {
    output = response.text();
  } catch {
    // text() may throw if response has function calls or other non-text content
    output = safeExtract(() => {
      const content = response.candidates?.[0]?.content;
      if (content?.parts) {
        return content.parts;
      }
      return null;
    }, null);
  }

  // Extract token usage
  const usage = response.usageMetadata;
  const inputTokens = isValidNumber(usage?.promptTokenCount) ? usage!.promptTokenCount! : 0;
  const outputTokens = isValidNumber(usage?.candidatesTokenCount) ? usage!.candidatesTokenCount! : 0;

  // Build metadata
  const metadata: Record<string, unknown> = {};

  if (usage?.cachedContentTokenCount && usage.cachedContentTokenCount > 0) {
    metadata.cachedTokens = usage.cachedContentTokenCount;
  }

  if (usage?.thoughtsTokenCount && usage.thoughtsTokenCount > 0) {
    metadata.thoughtsTokens = usage.thoughtsTokenCount;
  }

  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason) {
    metadata.finishReason = finishReason;
  }

  return {
    output,
    inputTokens,
    outputTokens,
    metadata: Object.keys(metadata).length > 0 ? metadata : {},
  };
}
