/**
 * Google Gemini Provider Wrapper
 *
 * Wraps @google/generative-ai to automatically capture LLM calls.
 * SDK thin: only captures timing and raw response.
 * Server smart: extracts tokens, output, tools, etc.
 */

import type { ProviderName } from '../core/types';
import { captureTrace, captureError } from '../core/capture';
import { registerToolCalls } from '../core/context';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface GeminiClient {
  getGenerativeModel: (config: ModelConfig) => GenerativeModel;
}

interface ModelConfig {
  model: string;
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
  [key: string]: unknown;
}

interface Content {
  role?: string;
  parts: Part[];
}

interface Part {
  text?: string;
  functionCall?: { name: string; args: unknown };
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
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
}

interface ChatConfig {
  [key: string]: unknown;
}

interface ChatSession {
  sendMessage: (request: string | Part[]) => Promise<GenerateContentResult>;
  sendMessageStream: (request: string | Part[]) => Promise<StreamGenerateContentResult>;
}

// ─────────────────────────────────────────────────────────────
// Provider Implementation
// ─────────────────────────────────────────────────────────────

export const PROVIDER_NAME: ProviderName = 'gemini';

export function canHandle(client: unknown): boolean {
  if (!client || typeof client !== 'object') return false;
  const constructorName = client.constructor?.name;
  if (constructorName === 'GoogleGenerativeAI') return true;
  if (constructorName === 'GoogleGenAI') return true;
  const c = client as Record<string, unknown>;
  if (typeof c.getGenerativeModel === 'function') return true;
  if (c.models && typeof (c.models as Record<string, unknown>).generate === 'function') {
    return true;
  }
  return false;
}

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
// generateContent
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

      // Build raw response from Gemini's response object
      const rawResponse = buildRawResponse(result.response);

      const spanId = captureTrace({
        provider: PROVIDER_NAME,
        model: modelName,
        input,
        rawResponse, // Server extracts everything
        durationMs,
        status: 'success',
        streaming: false,
      });

      // Register function calls for hierarchy
      if (spanId) {
        const functionCallIds = extractFunctionCallIds(result.response);
        if (functionCallIds.length > 0) {
          registerToolCalls(functionCallIds, spanId);
        }
      }

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
// generateContentStream
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
  // Accumulate to build final response
  const finalResponse: {
    candidates: Candidate[];
    usageMetadata?: UsageMetadata;
  } = { candidates: [{ content: { parts: [] } }] };
  let error: Error | null = null;
  let firstTokenMs: number | undefined;
  let firstTokenReceived = false;

  try {
    for await (const chunk of stream) {
      // Accumulate text
      try {
        const text = chunk.text();
        if (text) {
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            firstTokenMs = Date.now() - startTime;
          }
          // Add text part to accumulated response
          const parts = finalResponse.candidates[0].content?.parts || [];
          const lastPart = parts[parts.length - 1];
          if (lastPart?.text !== undefined) {
            lastPart.text += text;
          } else {
            parts.push({ text });
          }
        }
      } catch {
        // text() may throw if no text content
      }

      // Extract candidates for function calls
      if (chunk.candidates?.[0]?.content?.parts) {
        for (const part of chunk.candidates[0].content.parts) {
          if (part.functionCall) {
            finalResponse.candidates[0].content?.parts?.push(part);
          }
        }
      }

      // Capture usage and finish reason from last chunk
      if (chunk.usageMetadata) {
        finalResponse.usageMetadata = chunk.usageMetadata;
      }
      if (chunk.candidates?.[0]?.finishReason) {
        finalResponse.candidates[0].finishReason = chunk.candidates[0].finishReason;
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
      const spanId = captureTrace({
        provider: PROVIDER_NAME,
        model: modelName,
        input,
        rawResponse: finalResponse,
        durationMs,
        status: 'success',
        streaming: true,
        firstTokenMs,
      });

      if (spanId) {
        const functionCallIds = extractFunctionCallIdsFromCandidates(finalResponse.candidates);
        if (functionCallIds.length > 0) {
          registerToolCalls(functionCallIds, spanId);
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Chat
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
    const input = request;

    try {
      const result = await originalFn(request);
      const durationMs = Date.now() - startTime;
      const rawResponse = buildRawResponse(result.response);

      const spanId = captureTrace({
        provider: PROVIDER_NAME,
        model: modelName,
        input,
        rawResponse,
        durationMs,
        status: 'success',
        streaming: false,
      });

      if (spanId) {
        const functionCallIds = extractFunctionCallIds(result.response);
        if (functionCallIds.length > 0) {
          registerToolCalls(functionCallIds, spanId);
        }
      }

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
    const input = request;

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
// Helpers
// ─────────────────────────────────────────────────────────────

function extractInput(request: GenerateContentRequest | string): unknown {
  if (typeof request === 'string') return request;
  if (request.contents) return request.contents;
  return request;
}

function buildRawResponse(response: GenerateContentResponse): unknown {
  // Build a serializable response object
  return {
    candidates: response.candidates,
    usageMetadata: response.usageMetadata,
  };
}

function extractFunctionCallIds(response: GenerateContentResponse): string[] {
  const ids: string[] = [];
  const parts = response.candidates?.[0]?.content?.parts;
  if (parts) {
    parts.forEach((part, index) => {
      if (part.functionCall?.name) {
        ids.push(`gemini-fc-${part.functionCall.name}-${index}`);
      }
    });
  }
  return ids;
}

function extractFunctionCallIdsFromCandidates(candidates: Candidate[]): string[] {
  const ids: string[] = [];
  const parts = candidates?.[0]?.content?.parts;
  if (parts) {
    parts.forEach((part, index) => {
      if (part.functionCall?.name) {
        ids.push(`gemini-fc-${part.functionCall.name}-${index}`);
      }
    });
  }
  return ids;
}
