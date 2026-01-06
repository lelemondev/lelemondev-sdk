import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canHandle, wrap, PROVIDER_NAME, wrapResponsesCreate } from '../../src/providers/openai';
import {
  createChatCompletionResponse,
  createToolCallResponse,
  createStreamingResponse,
  createStreamingErrorResponse,
  createCompletionResponse,
  createEmbeddingsResponse,
} from '../fixtures/openai';
import { createMockOpenAIClient } from '../helpers/mock-client';

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

describe('OpenAI Provider', () => {
  beforeEach(() => {
    mockCaptureTrace.mockClear();
    mockCaptureError.mockClear();
  });

  describe('PROVIDER_NAME', () => {
    it('should be "openai"', () => {
      expect(PROVIDER_NAME).toBe('openai');
    });
  });

  describe('canHandle', () => {
    it('should detect OpenAI by constructor name', () => {
      const client = { constructor: { name: 'OpenAI' } };
      expect(canHandle(client)).toBe(true);
    });

    it('should detect by chat and completions properties', () => {
      const client = { chat: {}, completions: {} };
      expect(canHandle(client)).toBe(true);
    });

    it('should detect by responses property', () => {
      const client = { responses: { create: vi.fn() } };
      expect(canHandle(client)).toBe(true);
    });

    it('should reject Anthropic client', () => {
      const client = { constructor: { name: 'Anthropic' }, messages: {} };
      expect(canHandle(client)).toBe(false);
    });

    it('should reject Gemini client', () => {
      const client = { constructor: { name: 'GoogleGenerativeAI' } };
      expect(canHandle(client)).toBe(false);
    });

    it('should reject null', () => {
      expect(canHandle(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(canHandle(undefined)).toBe(false);
    });
  });

  describe('chat.completions.create', () => {
    it('should capture trace on successful chat completion', async () => {
      const mockResponse = createChatCompletionResponse();
      const mockCreate = vi.fn().mockResolvedValue(mockResponse);

      const client = {
        chat: { completions: { create: mockCreate } },
        completions: {},
        constructor: { name: 'OpenAI' },
      };

      const wrapped = wrap(client) as typeof client;
      await wrapped.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o-mini',
          rawResponse: expect.objectContaining({
            choices: expect.arrayContaining([
              expect.objectContaining({
                message: expect.objectContaining({
                  content: 'Hello! How can I help you today?',
                }),
              }),
            ]),
            usage: expect.objectContaining({
              prompt_tokens: 10,
              completion_tokens: 15,
            }),
          }),
          streaming: false,
        })
      );
    });

    it('should capture error on failed chat completion', async () => {
      const mockError = new Error('API Error');
      const mockCreate = vi.fn().mockRejectedValue(mockError);

      const client = {
        chat: { completions: { create: mockCreate } },
        completions: {},
        constructor: { name: 'OpenAI' },
      };

      const wrapped = wrap(client) as typeof client;

      await expect(
        wrapped.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow('API Error');

      expect(mockCaptureError).toHaveBeenCalledOnce();
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o-mini',
          error: mockError,
        })
      );
    });

    it('should handle tool call responses', async () => {
      const mockResponse = createToolCallResponse();
      const mockCreate = vi.fn().mockResolvedValue(mockResponse);

      const client = {
        chat: { completions: { create: mockCreate } },
        completions: {},
        constructor: { name: 'OpenAI' },
      };

      const wrapped = wrap(client) as typeof client;
      await wrapped.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'What is the weather?' }],
      });

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          rawResponse: expect.objectContaining({
            usage: expect.objectContaining({
              prompt_tokens: 20,
              completion_tokens: 25,
            }),
          }),
        })
      );
    });

    it('should capture trace after streaming completes', async () => {
      const mockStream = createStreamingResponse('Hello streaming world');
      const mockCreate = vi.fn().mockResolvedValue(mockStream);

      const client = {
        chat: { completions: { create: mockCreate } },
        completions: {},
        constructor: { name: 'OpenAI' },
      };

      const wrapped = wrap(client) as typeof client;
      const result = await wrapped.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      });

      const chunks: string[] = [];
      for await (const chunk of result as AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>) {
        if (chunk.choices?.[0]?.delta?.content) {
          chunks.push(chunk.choices[0].delta.content);
        }
      }

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          streaming: true,
        })
      );
    });

    it('should capture error when stream fails', async () => {
      const mockStream = createStreamingErrorResponse();
      const mockCreate = vi.fn().mockResolvedValue(mockStream);

      const client = {
        chat: { completions: { create: mockCreate } },
        completions: {},
        constructor: { name: 'OpenAI' },
      };

      const wrapped = wrap(client) as typeof client;
      const result = await wrapped.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      });

      try {
        for await (const _ of result as AsyncIterable<unknown>) {
          // consume stream
        }
      } catch {
        // Expected error
      }

      expect(mockCaptureError).toHaveBeenCalledOnce();
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          streaming: true,
        })
      );
    });
  });

  describe('responses.create (new API)', () => {
    it('should capture trace on successful responses.create', async () => {
      const mockResponse = {
        id: 'resp_123',
        output_text: 'Hello from Responses API!',
        usage: {
          input_tokens: 15,
          output_tokens: 20,
          total_tokens: 35,
        },
      };
      const mockCreate = vi.fn().mockResolvedValue(mockResponse);

      const client = {
        chat: { completions: { create: vi.fn() } },
        responses: { create: mockCreate },
        completions: {},
        constructor: { name: 'OpenAI' },
      };

      const wrapped = wrap(client) as typeof client;
      await wrapped.responses!.create({
        model: 'gpt-4o',
        instructions: 'You are a helpful assistant.',
        input: 'Hello!',
      });

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o',
          rawResponse: expect.objectContaining({
            output_text: 'Hello from Responses API!',
            usage: expect.objectContaining({
              input_tokens: 15,
              output_tokens: 20,
            }),
          }),
          streaming: false,
        })
      );
    });

    it('should capture input with instructions and input', async () => {
      const mockResponse = {
        id: 'resp_123',
        output_text: 'Response',
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const mockCreate = vi.fn().mockResolvedValue(mockResponse);

      const client = {
        responses: { create: mockCreate },
        constructor: { name: 'OpenAI' },
      };

      const wrapped = wrap(client) as typeof client;
      await wrapped.responses!.create({
        model: 'gpt-4o',
        instructions: 'Be helpful',
        input: 'What is 2+2?',
      });

      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          input: { instructions: 'Be helpful', input: 'What is 2+2?' },
        })
      );
    });

    it('should capture error on failed responses.create', async () => {
      const mockError = new Error('API Error');
      const mockCreate = vi.fn().mockRejectedValue(mockError);

      const client = {
        responses: { create: mockCreate },
        constructor: { name: 'OpenAI' },
      };

      const wrapped = wrap(client) as typeof client;

      await expect(
        wrapped.responses!.create({
          model: 'gpt-4o',
          input: 'Hello',
        })
      ).rejects.toThrow('API Error');

      expect(mockCaptureError).toHaveBeenCalledOnce();
    });
  });

  describe('completions.create (legacy)', () => {
    it('should capture trace on legacy completion', async () => {
      const mockResponse = createCompletionResponse();
      const mockCreate = vi.fn().mockResolvedValue(mockResponse);

      const client = {
        chat: { completions: { create: vi.fn() } },
        completions: { create: mockCreate },
        constructor: { name: 'OpenAI' },
      };

      const wrapped = wrap(client) as typeof client;
      await wrapped.completions!.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: 'Say hello',
      });

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-3.5-turbo-instruct',
          rawResponse: expect.objectContaining({
            choices: expect.arrayContaining([
              expect.objectContaining({
                text: 'This is a completion.',
              }),
            ]),
          }),
        })
      );
    });
  });

  describe('embeddings.create', () => {
    it('should capture trace on embeddings', async () => {
      const mockResponse = createEmbeddingsResponse();
      const mockCreate = vi.fn().mockResolvedValue(mockResponse);

      const client = {
        chat: { completions: { create: vi.fn() } },
        completions: {},
        embeddings: { create: mockCreate },
        constructor: { name: 'OpenAI' },
      };

      const wrapped = wrap(client) as typeof client;
      await wrapped.embeddings!.create({
        model: 'text-embedding-3-small',
        input: 'Hello world',
      });

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'text-embedding-3-small',
          rawResponse: expect.objectContaining({
            usage: expect.objectContaining({
              prompt_tokens: 8,
              total_tokens: 8,
            }),
          }),
        })
      );
    });
  });

  describe('wrap', () => {
    it('should return a proxy that preserves client identity', () => {
      const client = createMockOpenAIClient();
      const wrapped = wrap(client);

      expect(wrapped).not.toBe(client);
      expect((wrapped as typeof client).chat).toBeDefined();
    });

    it('should pass through non-traced methods', () => {
      const client = {
        chat: { completions: { create: vi.fn() } },
        completions: {},
        otherMethod: vi.fn().mockReturnValue('other'),
        constructor: { name: 'OpenAI' },
      };

      const wrapped = wrap(client) as typeof client;
      const result = wrapped.otherMethod();

      expect(result).toBe('other');
    });
  });
});
