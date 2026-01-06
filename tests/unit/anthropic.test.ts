import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canHandle, wrap, PROVIDER_NAME } from '../../src/providers/anthropic';
import {
  createMessageResponse,
  createToolUseResponse,
  createMultiBlockResponse,
  createStreamingResponse,
  createStreamWithError,
  createAnthropicStreamObject,
  createMockAnthropicClient,
} from '../fixtures/anthropic';

// Mock config module
vi.mock('../../src/core/config', () => ({
  getConfig: () => ({ disabled: false, debug: false }),
}));

// Mock capture module
const mockCaptureTrace = vi.fn();
const mockCaptureError = vi.fn();
const mockCaptureToolSpans = vi.fn();

vi.mock('../../src/core/capture', () => ({
  captureTrace: (params: unknown) => mockCaptureTrace(params),
  captureError: (params: unknown) => mockCaptureError(params),
  captureToolSpans: (toolCalls: unknown, provider: unknown) => mockCaptureToolSpans(toolCalls, provider),
}));

describe('Anthropic Provider', () => {
  beforeEach(() => {
    mockCaptureTrace.mockClear();
    mockCaptureError.mockClear();
    mockCaptureToolSpans.mockClear();
  });

  describe('PROVIDER_NAME', () => {
    it('should be "anthropic"', () => {
      expect(PROVIDER_NAME).toBe('anthropic');
    });
  });

  describe('canHandle', () => {
    it('should detect Anthropic by constructor name', () => {
      const client = { constructor: { name: 'Anthropic' } };
      expect(canHandle(client)).toBe(true);
    });

    it('should detect by messages property', () => {
      const client = { messages: { create: vi.fn() } };
      expect(canHandle(client)).toBe(true);
    });

    it('should reject OpenAI client', () => {
      const client = { constructor: { name: 'OpenAI' }, chat: { completions: {} } };
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

    it('should reject empty object', () => {
      expect(canHandle({})).toBe(false);
    });
  });

  describe('messages.create', () => {
    it('should capture trace on successful message', async () => {
      const mockResponse = createMessageResponse();
      const mockCreate = vi.fn().mockResolvedValue(mockResponse);

      const client = {
        messages: { create: mockCreate },
        constructor: { name: 'Anthropic' },
      };

      const wrapped = wrap(client) as typeof client;
      await wrapped.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
          rawResponse: expect.objectContaining({
            content: expect.any(Array),
            usage: expect.objectContaining({
              input_tokens: 10,
              output_tokens: 15,
            }),
          }),
          streaming: false,
        })
      );
    });

    it('should capture error on failed message', async () => {
      const mockError = new Error('API Error');
      const mockCreate = vi.fn().mockRejectedValue(mockError);

      const client = {
        messages: { create: mockCreate },
        constructor: { name: 'Anthropic' },
      };

      const wrapped = wrap(client) as typeof client;

      await expect(
        wrapped.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow('API Error');

      expect(mockCaptureError).toHaveBeenCalledOnce();
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-3-haiku-20240307',
          error: mockError,
        })
      );
    });

    it('should handle tool use responses', async () => {
      const mockResponse = createToolUseResponse();
      const mockCreate = vi.fn().mockResolvedValue(mockResponse);

      const client = {
        messages: { create: mockCreate },
        constructor: { name: 'Anthropic' },
      };

      const wrapped = wrap(client) as typeof client;
      await wrapped.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'What is the weather?' }],
      });

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          rawResponse: expect.objectContaining({
            usage: expect.objectContaining({
              input_tokens: 25,
              output_tokens: 30,
            }),
          }),
        })
      );
    });

    it('should handle multi-block text responses', async () => {
      const mockResponse = createMultiBlockResponse();
      const mockCreate = vi.fn().mockResolvedValue(mockResponse);

      const client = {
        messages: { create: mockCreate },
        constructor: { name: 'Anthropic' },
      };

      const wrapped = wrap(client) as typeof client;
      await wrapped.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Analyze this' }],
      });

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          rawResponse: expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ type: 'text' }),
            ]),
          }),
        })
      );
    });

    it('should capture trace after streaming completes', async () => {
      const mockStream = createStreamingResponse('Hello streaming world');
      const mockCreate = vi.fn().mockResolvedValue(mockStream);

      const client = {
        messages: { create: mockCreate },
        constructor: { name: 'Anthropic' },
      };

      const wrapped = wrap(client) as typeof client;
      const result = await wrapped.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      });

      const chunks: string[] = [];
      for await (const event of result as AsyncIterable<{ type: string; delta?: { text?: string } }>) {
        if (event.type === 'content_block_delta' && event.delta?.text) {
          chunks.push(event.delta.text);
        }
      }

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          streaming: true,
        })
      );
    });

    it('should capture error when stream fails', async () => {
      const mockStream = createStreamWithError();
      const mockCreate = vi.fn().mockResolvedValue(mockStream);

      const client = {
        messages: { create: mockCreate },
        constructor: { name: 'Anthropic' },
      };

      const wrapped = wrap(client) as typeof client;
      const result = await wrapped.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
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
          provider: 'anthropic',
          streaming: true,
        })
      );
    });

    it('should include system prompt in input', async () => {
      const mockResponse = createMessageResponse();
      const mockCreate = vi.fn().mockResolvedValue(mockResponse);

      const client = {
        messages: { create: mockCreate },
        constructor: { name: 'Anthropic' },
      };

      const wrapped = wrap(client) as typeof client;
      await wrapped.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            system: 'You are a helpful assistant.',
          }),
        })
      );
    });
  });

  describe('messages.stream', () => {
    it('should capture trace on successful stream', async () => {
      const mockStreamObj = createAnthropicStreamObject('Hello from SDK stream');
      const mockStream = vi.fn().mockReturnValue(mockStreamObj);

      const client = {
        messages: { create: vi.fn(), stream: mockStream },
        constructor: { name: 'Anthropic' },
      };

      const wrapped = wrap(client) as typeof client;
      const result = wrapped.messages.stream!({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const chunks: string[] = [];
      for await (const event of result as AsyncIterable<{ type: string; delta?: { text?: string } }>) {
        if (event.type === 'content_block_delta' && event.delta?.text) {
          chunks.push(event.delta.text);
        }
      }

      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          streaming: true,
        })
      );
    });

    it('should preserve finalMessage method', async () => {
      const mockStreamObj = createAnthropicStreamObject('Test message');
      const mockStream = vi.fn().mockReturnValue(mockStreamObj);

      const client = {
        messages: { create: vi.fn(), stream: mockStream },
        constructor: { name: 'Anthropic' },
      };

      const wrapped = wrap(client) as typeof client;
      const result = wrapped.messages.stream!({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      }) as { finalMessage: () => Promise<unknown> };

      expect(result.finalMessage).toBeDefined();
      expect(typeof result.finalMessage).toBe('function');
    });
  });

  describe('wrap', () => {
    it('should return a proxy that preserves client identity', () => {
      const client = createMockAnthropicClient();
      const wrapped = wrap(client);

      expect(wrapped).not.toBe(client);
      expect((wrapped as typeof client).messages).toBeDefined();
    });

    it('should pass through non-traced properties', () => {
      const client = {
        messages: { create: vi.fn() },
        otherMethod: vi.fn().mockReturnValue('other'),
        constructor: { name: 'Anthropic' },
      };

      const wrapped = wrap(client) as typeof client;
      const result = wrapped.otherMethod();

      expect(result).toBe('other');
    });
  });
});
