/**
 * Google GenAI Provider Wrapper
 *
 * Wraps @google/genai (the NEW SDK) to automatically capture LLM calls.
 * SDK thin: only captures timing and raw response.
 * Server smart: extracts tokens, output, tools, etc.
 *
 * New API shape:
 *   const ai = new GoogleGenAI({ apiKey });
 *   ai.models.generateContent({ model, contents, config? })
 *   ai.models.generateContentStream({ model, contents, config? })
 *   ai.chats.create({ model }) => Chat
 *   chat.sendMessage({ message }) / chat.sendMessageStream({ message })
 */

import type { ProviderName } from '../core/types';
import { captureTrace, captureError } from '../core/capture';
import { registerToolCalls } from '../core/context';

// ─────────────────────────────────────────────────────────────
// Duck-typed Interfaces (no runtime imports from @google/genai)
// ─────────────────────────────────────────────────────────────

interface GoogleGenAIClient {
  models: ModelsNamespace;
  chats: ChatsNamespace;
}

interface ModelsNamespace {
  generateContent: (params: GenerateContentParams) => Promise<GenerateContentResponse>;
  generateContentStream: (params: GenerateContentParams) => Promise<AsyncIterable<GenerateContentStreamChunk>>;
}

interface ChatsNamespace {
  create: (params: ChatCreateParams) => Chat;
}

interface GenerateContentParams {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

interface GenerateContentResponse {
  text: string;
  candidates?: Candidate[];
  usageMetadata?: UsageMetadata;
  modelVersion?: string;
}

interface GenerateContentStreamChunk {
  text?: string;
  candidates?: Candidate[];
  usageMetadata?: UsageMetadata;
}

interface Candidate {
  content?: Content;
  finishReason?: string;
}

interface Content {
  role?: string;
  parts?: Part[];
}

interface Part {
  text?: string;
  functionCall?: { name: string; args: unknown };
  [key: string]: unknown;
}

interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

interface ChatCreateParams {
  model: string;
  [key: string]: unknown;
}

interface Chat {
  sendMessage: (params: ChatSendMessageParams) => Promise<GenerateContentResponse>;
  sendMessageStream: (params: ChatSendMessageParams) => Promise<AsyncIterable<GenerateContentStreamChunk>>;
}

interface ChatSendMessageParams {
  message: unknown;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
// Provider Implementation
// ─────────────────────────────────────────────────────────────

export const PROVIDER_NAME: ProviderName = 'gemini';

export function canHandle(client: unknown): boolean {
  if (!client || typeof client !== 'object') return false;
  const constructorName = (client as { constructor?: { name?: string } }).constructor?.name;

  // Constructor name detection
  if (constructorName === 'GoogleGenAI') return true;

  // Duck typing: client.models with generateContent function
  const c = client as Record<string, unknown>;
  if (
    c.models &&
    typeof c.models === 'object' &&
    typeof (c.models as Record<string, unknown>).generateContent === 'function' &&
    c.chats &&
    typeof c.chats === 'object'
  ) {
    return true;
  }

  return false;
}

export function wrap(client: unknown): unknown {
  const genaiClient = client as GoogleGenAIClient;

  return new Proxy(genaiClient, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'models' && value && typeof value === 'object') {
        return wrapModels(value as ModelsNamespace);
      }

      if (prop === 'chats' && value && typeof value === 'object') {
        return wrapChats(value as ChatsNamespace);
      }

      return value;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Models namespace wrapping
// ─────────────────────────────────────────────────────────────

function wrapModels(models: ModelsNamespace): ModelsNamespace {
  return new Proxy(models, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'generateContent' && typeof value === 'function') {
        return wrapGenerateContent(value.bind(target));
      }

      if (prop === 'generateContentStream' && typeof value === 'function') {
        return wrapGenerateContentStream(value.bind(target));
      }

      return value;
    },
  });
}

function wrapGenerateContent(
  originalFn: (params: GenerateContentParams) => Promise<GenerateContentResponse>
) {
  return async function wrappedGenerateContent(
    params: GenerateContentParams
  ): Promise<GenerateContentResponse> {
    const startTime = Date.now();
    const model = params.model;
    const input = extractInput(params);

    try {
      const response = await originalFn(params);
      const durationMs = Date.now() - startTime;

      const rawResponse = buildRawResponse(response);

      const spanId = captureTrace({
        provider: PROVIDER_NAME,
        model,
        input,
        rawResponse,
        durationMs,
        status: 'success',
        streaming: false,
      });

      // Register function calls for hierarchy
      if (spanId) {
        const functionCallIds = extractFunctionCallIds(response);
        if (functionCallIds.length > 0) {
          registerToolCalls(functionCallIds, spanId);
        }
      }

      return response;
    } catch (error) {
      captureError({
        provider: PROVIDER_NAME,
        model,
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
  originalFn: (params: GenerateContentParams) => Promise<AsyncIterable<GenerateContentStreamChunk>>
) {
  return async function wrappedGenerateContentStream(
    params: GenerateContentParams
  ): Promise<AsyncIterable<GenerateContentStreamChunk>> {
    const startTime = Date.now();
    const model = params.model;
    const input = extractInput(params);

    try {
      const stream = await originalFn(params);
      return wrapStream(stream, model, input, startTime);
    } catch (error) {
      captureError({
        provider: PROVIDER_NAME,
        model,
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
      const text = chunk.text;
      if (text) {
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          firstTokenMs = Date.now() - startTime;
        }
        const parts = finalResponse.candidates[0].content?.parts || [];
        const lastPart = parts[parts.length - 1];
        if (lastPart?.text !== undefined) {
          lastPart.text += text;
        } else {
          parts.push({ text });
        }
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
// Chats namespace wrapping
// ─────────────────────────────────────────────────────────────

function wrapChats(chats: ChatsNamespace): ChatsNamespace {
  return new Proxy(chats, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'create' && typeof value === 'function') {
        return wrapChatsCreate(value.bind(target));
      }

      return value;
    },
  });
}

function wrapChatsCreate(
  originalFn: (params: ChatCreateParams) => Chat
): (params: ChatCreateParams) => Chat {
  return function wrappedChatsCreate(params: ChatCreateParams): Chat {
    const chat = originalFn(params);
    return wrapChat(chat, params.model);
  };
}

function wrapChat(chat: Chat, modelName: string): Chat {
  return new Proxy(chat, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'sendMessage' && typeof value === 'function') {
        return wrapChatSendMessage(value.bind(target), modelName);
      }

      if (prop === 'sendMessageStream' && typeof value === 'function') {
        return wrapChatSendMessageStream(value.bind(target), modelName);
      }

      return value;
    },
  });
}

function wrapChatSendMessage(
  originalFn: (params: ChatSendMessageParams) => Promise<GenerateContentResponse>,
  modelName: string
) {
  return async function wrappedChatSendMessage(
    params: ChatSendMessageParams
  ): Promise<GenerateContentResponse> {
    const startTime = Date.now();
    const input = params.message;

    try {
      const response = await originalFn(params);
      const durationMs = Date.now() - startTime;
      const rawResponse = buildRawResponse(response);

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
        const functionCallIds = extractFunctionCallIds(response);
        if (functionCallIds.length > 0) {
          registerToolCalls(functionCallIds, spanId);
        }
      }

      return response;
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

function wrapChatSendMessageStream(
  originalFn: (params: ChatSendMessageParams) => Promise<AsyncIterable<GenerateContentStreamChunk>>,
  modelName: string
) {
  return async function wrappedChatSendMessageStream(
    params: ChatSendMessageParams
  ): Promise<AsyncIterable<GenerateContentStreamChunk>> {
    const startTime = Date.now();
    const input = params.message;

    try {
      const stream = await originalFn(params);
      return wrapStream(stream, modelName, input, startTime);
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

function extractInput(params: GenerateContentParams): unknown {
  return params.contents;
}

function buildRawResponse(response: GenerateContentResponse): unknown {
  return {
    candidates: response.candidates,
    usageMetadata: response.usageMetadata,
    modelVersion: response.modelVersion,
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
