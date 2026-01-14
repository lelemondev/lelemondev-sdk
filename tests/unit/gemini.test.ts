import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canHandle, wrap, PROVIDER_NAME } from '../../src/providers/gemini';
import {
  createGenerateContentResult,
  createFunctionCallResult,
  createStreamResult,
  createStreamWithError,
  createCachedContentResult,
  createThinkingResult,
} from '../fixtures/gemini';
import { createMockGeminiClient, createMockGeminiModel } from '../helpers/mock-client';

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

describe('Gemini Provider', () => {
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
    it('should detect GoogleGenerativeAI by constructor name', () => {
      const client = { constructor: { name: 'GoogleGenerativeAI' } };
      expect(canHandle(client)).toBe(true);
    });

    it('should detect GoogleGenAI by constructor name', () => {
      const client = { constructor: { name: 'GoogleGenAI' } };
      expect(canHandle(client)).toBe(true);
    });

    it('should detect by getGenerativeModel method', () => {
      const client = { getGenerativeModel: vi.fn() };
      expect(canHandle(client)).toBe(true);
    });

    it('should detect @google/genai by models.generate', () => {
      const client = { models: { generate: vi.fn() } };
      expect(canHandle(client)).toBe(true);
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

    // Direct model wrapping (for observe(model) pattern)
    it('should detect GenerativeModel by constructor name', () => {
      const model = { constructor: { name: 'GenerativeModel' } };
      expect(canHandle(model)).toBe(true);
    });

    it('should detect model by shape (generateContent + model property)', () => {
      const model = {
        generateContent: vi.fn(),
        generateContentStream: vi.fn(),
        model: 'gemini-2.5-flash',
      };
      expect(canHandle(model)).toBe(true);
    });
  });

  describe('generateContent', () => {
    it('should capture trace on successful generateContent', async () => {
      const mockResult = createGenerateContentResult();
      const mockGenerateContent = vi.fn().mockResolvedValue(mockResult);

      const client = createMockGeminiClient(mockGenerateContent);
      const wrapped = wrap(client) as typeof client;

      const model = wrapped.getGenerativeModel({ model: 'gemini-2.5-flash' });
      await model.generateContent('Hello');

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          input: 'Hello',
          rawResponse: expect.objectContaining({
            candidates: expect.any(Array),
            usageMetadata: expect.objectContaining({
              promptTokenCount: 10,
              candidatesTokenCount: 15,
            }),
          }),
          status: 'success',
          streaming: false,
        })
      );
    });

    it('should capture trace with contents array input', async () => {
      const mockResult = createGenerateContentResult();
      const mockGenerateContent = vi.fn().mockResolvedValue(mockResult);

      const client = createMockGeminiClient(mockGenerateContent);
      const wrapped = wrap(client) as typeof client;

      const model = wrapped.getGenerativeModel({ model: 'gemini-2.5-flash' });
      await model.generateContent({
        contents: [
          { role: 'user', parts: [{ text: 'Hello' }] },
        ],
      });

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          input: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        })
      );
    });

    it('should capture error on failed generateContent', async () => {
      const mockError = new Error('API Error');
      const mockGenerateContent = vi.fn().mockRejectedValue(mockError);

      const client = createMockGeminiClient(mockGenerateContent);
      const wrapped = wrap(client) as typeof client;

      const model = wrapped.getGenerativeModel({ model: 'gemini-2.5-flash' });

      await expect(model.generateContent('Hello')).rejects.toThrow('API Error');

      expect(mockCaptureError).toHaveBeenCalledOnce();
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          error: mockError,
          streaming: false,
        })
      );
    });

    it('should handle function call responses', async () => {
      const mockResult = createFunctionCallResult();
      const mockGenerateContent = vi.fn().mockResolvedValue(mockResult);

      const client = createMockGeminiClient(mockGenerateContent);
      const wrapped = wrap(client) as typeof client;

      const model = wrapped.getGenerativeModel({ model: 'gemini-2.5-flash' });
      await model.generateContent('What is the weather?');

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
      const mockResult = createCachedContentResult();
      const mockGenerateContent = vi.fn().mockResolvedValue(mockResult);

      const client = createMockGeminiClient(mockGenerateContent);
      const wrapped = wrap(client) as typeof client;

      const model = wrapped.getGenerativeModel({ model: 'gemini-2.5-flash' });
      await model.generateContent('Hello');

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
      const mockResult = createThinkingResult();
      const mockGenerateContent = vi.fn().mockResolvedValue(mockResult);

      const client = createMockGeminiClient(mockGenerateContent);
      const wrapped = wrap(client) as typeof client;

      const model = wrapped.getGenerativeModel({ model: 'gemini-2.5-flash' });
      await model.generateContent('Think about this');

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

  describe('generateContentStream', () => {
    it('should capture trace after stream completes', async () => {
      const mockResult = createStreamResult('Hello streaming world');
      const mockGenerateContentStream = vi.fn().mockResolvedValue(mockResult);

      const mockModel = createMockGeminiModel({
        generateContentStream: mockGenerateContentStream,
      });

      const client = {
        getGenerativeModel: vi.fn(() => mockModel),
        constructor: { name: 'GoogleGenerativeAI' },
      };

      const wrapped = wrap(client) as typeof client;
      const model = wrapped.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContentStream('Hello');

      const chunks: string[] = [];
      for await (const chunk of result.stream) {
        chunks.push(chunk.text());
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
      const mockResult = createStreamWithError();
      const mockGenerateContentStream = vi.fn().mockResolvedValue(mockResult);

      const mockModel = createMockGeminiModel({
        generateContentStream: mockGenerateContentStream,
      });

      const client = {
        getGenerativeModel: vi.fn(() => mockModel),
        constructor: { name: 'GoogleGenerativeAI' },
      };

      const wrapped = wrap(client) as typeof client;
      const model = wrapped.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContentStream('Hello');

      const chunks: string[] = [];
      try {
        for await (const chunk of result.stream) {
          chunks.push(chunk.text());
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

  describe('chat', () => {
    it('should capture trace on sendMessage', async () => {
      const mockResult = createGenerateContentResult({ text: 'Chat response' });
      const mockSendMessage = vi.fn().mockResolvedValue(mockResult);

      const mockChat = {
        sendMessage: mockSendMessage,
        sendMessageStream: vi.fn(),
        getHistory: vi.fn().mockResolvedValue([]),
      };

      const mockModel = createMockGeminiModel({
        startChat: vi.fn(() => mockChat),
      });

      const client = {
        getGenerativeModel: vi.fn(() => mockModel),
        constructor: { name: 'GoogleGenerativeAI' },
      };

      const wrapped = wrap(client) as typeof client;
      const model = wrapped.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const chat = model.startChat();
      await chat.sendMessage('Hello');

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          input: 'Hello',
          rawResponse: expect.any(Object),
          streaming: false,
        })
      );
    });

    it('should capture trace on sendMessageStream', async () => {
      const mockResult = createStreamResult('Streaming chat response');
      const mockSendMessageStream = vi.fn().mockResolvedValue(mockResult);

      const mockChat = {
        sendMessage: vi.fn(),
        sendMessageStream: mockSendMessageStream,
        getHistory: vi.fn().mockResolvedValue([]),
      };

      const mockModel = createMockGeminiModel({
        startChat: vi.fn(() => mockChat),
      });

      const client = {
        getGenerativeModel: vi.fn(() => mockModel),
        constructor: { name: 'GoogleGenerativeAI' },
      };

      const wrapped = wrap(client) as typeof client;
      const model = wrapped.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const chat = model.startChat();
      const result = await chat.sendMessageStream('Hello');

      const chunks: string[] = [];
      for await (const chunk of result.stream) {
        chunks.push(chunk.text());
      }

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          streaming: true,
        })
      );
    });
  });

  describe('wrap', () => {
    it('should return a proxy that preserves client identity', () => {
      const client = createMockGeminiClient();
      const wrapped = wrap(client);

      expect(wrapped).not.toBe(client);
      expect(typeof (wrapped as typeof client).getGenerativeModel).toBe('function');
    });

    it('should pass through non-traced methods', () => {
      const client = {
        getGenerativeModel: vi.fn(),
        otherMethod: vi.fn().mockReturnValue('other'),
        constructor: { name: 'GoogleGenerativeAI' },
      };

      const wrapped = wrap(client) as typeof client;
      const result = wrapped.otherMethod();

      expect(result).toBe('other');
    });
  });

  describe('wrap (direct model)', () => {
    it('should wrap GenerativeModel directly and capture traces', async () => {
      const mockResult = createGenerateContentResult();
      const mockGenerateContent = vi.fn().mockResolvedValue(mockResult);

      const model = {
        model: 'gemini-2.5-flash',
        generateContent: mockGenerateContent,
        generateContentStream: vi.fn(),
        startChat: vi.fn(),
        constructor: { name: 'GenerativeModel' },
      };

      const wrapped = wrap(model) as typeof model;
      await wrapped.generateContent('Hello');

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          input: 'Hello',
          status: 'success',
          streaming: false,
        })
      );
    });

    it('should wrap model startChat and capture sendMessage traces', async () => {
      const mockResult = createGenerateContentResult({ text: 'Chat response' });
      const mockSendMessage = vi.fn().mockResolvedValue(mockResult);

      const mockChat = {
        sendMessage: mockSendMessage,
        sendMessageStream: vi.fn(),
        getHistory: vi.fn().mockResolvedValue([]),
      };

      const model = {
        model: 'gemini-2.5-flash',
        generateContent: vi.fn(),
        generateContentStream: vi.fn(),
        startChat: vi.fn(() => mockChat),
        constructor: { name: 'GenerativeModel' },
      };

      const wrapped = wrap(model) as typeof model;
      const chat = wrapped.startChat();
      await chat.sendMessage('Hello');

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          input: 'Hello',
        })
      );
    });
  });
});
