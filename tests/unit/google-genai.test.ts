import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canHandle, wrap, PROVIDER_NAME } from '../../src/providers/google-genai';
import {
  createGenAIGenerateContentResponse,
  createGenAIFunctionCallResponse,
  createGenAIStreamChunks,
  createGenAIStreamWithError,
  createGenAICachedContentResponse,
  createGenAIThinkingResponse,
} from '../fixtures/google-genai';
import { createMockGoogleGenAIClient } from '../helpers/mock-client';

// Mock config module
vi.mock('../../src/core/config', () => ({
  getConfig: () => ({ disabled: false, debug: false }),
}));

// Mock capture module
const mockCaptureTrace = vi.fn();
const mockCaptureError = vi.fn();

vi.mock('../../src/core/capture', () => ({
  captureTrace: (params: unknown) => mockCaptureTrace(params),
  captureError: (params: unknown) => mockCaptureError(params),
}));

describe('Google GenAI Provider (@google/genai)', () => {
  beforeEach(() => {
    mockCaptureTrace.mockClear();
    mockCaptureError.mockClear();
  });

  describe('PROVIDER_NAME', () => {
    it('should be "gemini"', () => {
      expect(PROVIDER_NAME).toBe('gemini');
    });
  });

  describe('canHandle', () => {
    it('should detect GoogleGenAI by constructor name', () => {
      const client = createMockGoogleGenAIClient();
      expect(canHandle(client)).toBe(true);
    });

    it('should detect by duck typing (models.generateContent + chats)', () => {
      const client = {
        models: { generateContent: vi.fn(), generateContentStream: vi.fn() },
        chats: { create: vi.fn() },
      };
      expect(canHandle(client)).toBe(true);
    });

    it('should reject old GoogleGenerativeAI client', () => {
      const client = {
        getGenerativeModel: vi.fn(),
        constructor: { name: 'GoogleGenerativeAI' },
      };
      expect(canHandle(client)).toBe(false);
    });

    it('should reject OpenAI client', () => {
      const client = { constructor: { name: 'OpenAI' }, chat: {} };
      expect(canHandle(client)).toBe(false);
    });

    it('should reject Anthropic client', () => {
      const client = { constructor: { name: 'Anthropic' }, messages: {} };
      expect(canHandle(client)).toBe(false);
    });

    it('should reject null', () => {
      expect(canHandle(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(canHandle(undefined)).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(canHandle('string')).toBe(false);
      expect(canHandle(123)).toBe(false);
    });

    it('should reject objects with models but no chats', () => {
      const client = {
        models: { generateContent: vi.fn() },
      };
      expect(canHandle(client)).toBe(false);
    });
  });

  describe('models.generateContent', () => {
    it('should capture trace on successful generateContent', async () => {
      const mockResponse = createGenAIGenerateContentResponse();
      const mockGenerateContent = vi.fn().mockResolvedValue(mockResponse);

      const client = createMockGoogleGenAIClient({ generateContent: mockGenerateContent });
      const wrapped = wrap(client) as typeof client;

      await wrapped.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: 'Hello',
      });

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.0-flash',
          input: 'Hello',
          rawResponse: expect.objectContaining({
            candidates: expect.any(Array),
            usageMetadata: expect.objectContaining({
              promptTokenCount: 10,
              candidatesTokenCount: 15,
            }),
            modelVersion: 'gemini-2.0-flash',
          }),
          status: 'success',
          streaming: false,
        })
      );
    });

    it('should capture trace with contents array input', async () => {
      const mockResponse = createGenAIGenerateContentResponse();
      const mockGenerateContent = vi.fn().mockResolvedValue(mockResponse);

      const client = createMockGoogleGenAIClient({ generateContent: mockGenerateContent });
      const wrapped = wrap(client) as typeof client;

      const contents = [
        { role: 'user', parts: [{ text: 'Hello' }] },
      ];

      await wrapped.models.generateContent({
        model: 'gemini-2.0-flash',
        contents,
      });

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          input: contents,
        })
      );
    });

    it('should capture error on failed generateContent', async () => {
      const mockError = new Error('API Error');
      const mockGenerateContent = vi.fn().mockRejectedValue(mockError);

      const client = createMockGoogleGenAIClient({ generateContent: mockGenerateContent });
      const wrapped = wrap(client) as typeof client;

      await expect(
        wrapped.models.generateContent({ model: 'gemini-2.0-flash', contents: 'Hello' })
      ).rejects.toThrow('API Error');

      expect(mockCaptureError).toHaveBeenCalledOnce();
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.0-flash',
          error: mockError,
          streaming: false,
        })
      );
    });

    it('should handle function call responses', async () => {
      const mockResponse = createGenAIFunctionCallResponse();
      const mockGenerateContent = vi.fn().mockResolvedValue(mockResponse);

      const client = createMockGoogleGenAIClient({ generateContent: mockGenerateContent });
      const wrapped = wrap(client) as typeof client;

      await wrapped.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: 'What is the weather?',
      });

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          rawResponse: expect.objectContaining({
            usageMetadata: expect.objectContaining({
              promptTokenCount: 20,
              candidatesTokenCount: 10,
            }),
          }),
        })
      );
    });

    it('should capture cached content tokens in rawResponse', async () => {
      const mockResponse = createGenAICachedContentResponse();
      const mockGenerateContent = vi.fn().mockResolvedValue(mockResponse);

      const client = createMockGoogleGenAIClient({ generateContent: mockGenerateContent });
      const wrapped = wrap(client) as typeof client;

      await wrapped.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: 'Hello',
      });

      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          rawResponse: expect.objectContaining({
            usageMetadata: expect.objectContaining({
              cachedContentTokenCount: 1000,
            }),
          }),
        })
      );
    });

    it('should capture thinking tokens in rawResponse', async () => {
      const mockResponse = createGenAIThinkingResponse();
      const mockGenerateContent = vi.fn().mockResolvedValue(mockResponse);

      const client = createMockGoogleGenAIClient({ generateContent: mockGenerateContent });
      const wrapped = wrap(client) as typeof client;

      await wrapped.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: 'Think about this',
      });

      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          rawResponse: expect.objectContaining({
            usageMetadata: expect.objectContaining({
              thoughtsTokenCount: 512,
            }),
          }),
        })
      );
    });
  });

  describe('models.generateContentStream', () => {
    it('should capture trace after stream completes', async () => {
      const mockStream = createGenAIStreamChunks('Hello streaming world');
      const mockGenerateContentStream = vi.fn().mockResolvedValue(mockStream);

      const client = createMockGoogleGenAIClient({
        generateContentStream: mockGenerateContentStream,
      });
      const wrapped = wrap(client) as typeof client;

      const stream = await wrapped.models.generateContentStream({
        model: 'gemini-2.0-flash',
        contents: 'Hello',
      });

      const chunks: string[] = [];
      for await (const chunk of stream as AsyncIterable<{ text?: string }>) {
        if (chunk.text) chunks.push(chunk.text);
      }

      expect(chunks.join('')).toBe('Hello streaming world');
      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          rawResponse: expect.any(Object),
          streaming: true,
        })
      );
    });

    it('should capture error when stream fails', async () => {
      const mockStream = createGenAIStreamWithError();
      const mockGenerateContentStream = vi.fn().mockResolvedValue(mockStream);

      const client = createMockGoogleGenAIClient({
        generateContentStream: mockGenerateContentStream,
      });
      const wrapped = wrap(client) as typeof client;

      const stream = await wrapped.models.generateContentStream({
        model: 'gemini-2.0-flash',
        contents: 'Hello',
      });

      const chunks: string[] = [];
      try {
        for await (const chunk of stream as AsyncIterable<{ text?: string }>) {
          if (chunk.text) chunks.push(chunk.text);
        }
      } catch {
        // Expected error
      }

      expect(mockCaptureError).toHaveBeenCalledOnce();
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          streaming: true,
        })
      );
    });
  });

  describe('chats', () => {
    it('should capture trace on chat.sendMessage', async () => {
      const mockResponse = createGenAIGenerateContentResponse({ text: 'Chat response' });
      const mockSendMessage = vi.fn().mockResolvedValue(mockResponse);

      const mockChat = {
        sendMessage: mockSendMessage,
        sendMessageStream: vi.fn(),
      };

      const client = createMockGoogleGenAIClient({
        chatsCreate: vi.fn(() => mockChat),
      });
      const wrapped = wrap(client) as typeof client;

      const chat = wrapped.chats.create({ model: 'gemini-2.0-flash' });
      await chat.sendMessage({ message: 'Hello' });

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.0-flash',
          input: 'Hello',
          rawResponse: expect.any(Object),
          streaming: false,
        })
      );
    });

    it('should capture trace on chat.sendMessageStream', async () => {
      const mockStream = createGenAIStreamChunks('Streaming chat response');
      const mockSendMessageStream = vi.fn().mockResolvedValue(mockStream);

      const mockChat = {
        sendMessage: vi.fn(),
        sendMessageStream: mockSendMessageStream,
      };

      const client = createMockGoogleGenAIClient({
        chatsCreate: vi.fn(() => mockChat),
      });
      const wrapped = wrap(client) as typeof client;

      const chat = wrapped.chats.create({ model: 'gemini-2.0-flash' });
      const stream = await chat.sendMessageStream({ message: 'Hello' });

      const chunks: string[] = [];
      for await (const chunk of stream as AsyncIterable<{ text?: string }>) {
        if (chunk.text) chunks.push(chunk.text);
      }

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.0-flash',
          streaming: true,
        })
      );
    });

    it('should capture error on chat.sendMessage failure', async () => {
      const mockError = new Error('Chat API Error');
      const mockSendMessage = vi.fn().mockRejectedValue(mockError);

      const mockChat = {
        sendMessage: mockSendMessage,
        sendMessageStream: vi.fn(),
      };

      const client = createMockGoogleGenAIClient({
        chatsCreate: vi.fn(() => mockChat),
      });
      const wrapped = wrap(client) as typeof client;

      const chat = wrapped.chats.create({ model: 'gemini-2.0-flash' });

      await expect(
        chat.sendMessage({ message: 'Hello' })
      ).rejects.toThrow('Chat API Error');

      expect(mockCaptureError).toHaveBeenCalledOnce();
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.0-flash',
          error: mockError,
          streaming: false,
        })
      );
    });
  });

  describe('wrap', () => {
    it('should return a proxy that preserves client shape', () => {
      const client = createMockGoogleGenAIClient();
      const wrapped = wrap(client) as typeof client;

      expect(wrapped).not.toBe(client);
      expect(typeof wrapped.models.generateContent).toBe('function');
      expect(typeof wrapped.models.generateContentStream).toBe('function');
      expect(typeof wrapped.chats.create).toBe('function');
    });

    it('should pass through non-traced properties', () => {
      const client = {
        ...createMockGoogleGenAIClient(),
        apiKey: 'test-key',
      };

      const wrapped = wrap(client) as typeof client;
      expect(wrapped.apiKey).toBe('test-key');
    });
  });
});
