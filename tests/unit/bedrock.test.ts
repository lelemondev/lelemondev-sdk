import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as bedrock from '../../src/providers/bedrock';
import {
  createMockBedrockClient,
  createConverseCommand,
  createConverseStreamCommand,
  createInvokeModelCommand,
  createMockOpenAIClient,
  createMockAnthropicClient,
} from '../helpers/mock-client';
import {
  createConverseResponse,
  createConverseStream,
  createConverseStreamError,
  createInvokeModelClaudeResponse,
  createInvokeModelTitanResponse,
  createInvokeModelLlamaResponse,
  createInvokeModelStream,
} from '../fixtures/bedrock';

// Mock capture module
const mockCaptureTrace = vi.fn();
const mockCaptureError = vi.fn();

vi.mock('../../src/core/capture', () => ({
  captureTrace: (params: unknown) => mockCaptureTrace(params),
  captureError: (params: unknown) => mockCaptureError(params),
}));

describe('Bedrock Provider', () => {
  beforeEach(() => {
    mockCaptureTrace.mockClear();
    mockCaptureError.mockClear();
  });

  describe('canHandle', () => {
    it('should return true for BedrockRuntimeClient by constructor name', () => {
      const client = createMockBedrockClient();
      expect(bedrock.canHandle(client)).toBe(true);
    });

    it('should return true for client with send + config.region shape', () => {
      const client = {
        send: vi.fn(),
        config: { region: 'us-west-2' },
        constructor: { name: 'CustomClient' },
      };
      expect(bedrock.canHandle(client)).toBe(true);
    });

    it('should return false for null/undefined', () => {
      expect(bedrock.canHandle(null)).toBe(false);
      expect(bedrock.canHandle(undefined)).toBe(false);
    });

    it('should return false for OpenAI client', () => {
      const client = createMockOpenAIClient();
      expect(bedrock.canHandle(client)).toBe(false);
    });

    it('should return false for Anthropic client', () => {
      const client = createMockAnthropicClient();
      expect(bedrock.canHandle(client)).toBe(false);
    });

    it('should return false for client without region', () => {
      const client = {
        send: vi.fn(),
        config: { timeout: 1000 },
      };
      expect(bedrock.canHandle(client)).toBe(false);
    });
  });

  describe('wrap', () => {
    it('should return a proxy that intercepts send', () => {
      const client = createMockBedrockClient();
      const wrapped = bedrock.wrap(client);

      expect(wrapped).not.toBe(client);
      expect(typeof (wrapped as typeof client).send).toBe('function');
    });

    it('should preserve other properties', () => {
      const client = {
        ...createMockBedrockClient(),
        customProp: 'test',
      };
      const wrapped = bedrock.wrap(client) as typeof client;

      expect(wrapped.customProp).toBe('test');
    });
  });

  describe('ConverseCommand', () => {
    it('should capture trace for successful call', async () => {
      const mockSend = vi.fn().mockResolvedValue(createConverseResponse());
      const client = createMockBedrockClient(mockSend);
      const wrapped = bedrock.wrap(client) as typeof client;

      const command = createConverseCommand({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        messages: [{ role: 'user', content: [{ text: 'Hello' }] }],
      });

      const result = await wrapped.send(command);

      expect(result).toEqual(createConverseResponse());
      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'bedrock',
          model: 'anthropic.claude-3-haiku-20240307-v1:0',
          status: 'success',
          streaming: false,
          inputTokens: 10,
          outputTokens: 15,
        })
      );
    });

    it('should capture error trace on failure', async () => {
      const mockSend = vi.fn().mockRejectedValue(new Error('Throttling'));
      const client = createMockBedrockClient(mockSend);
      const wrapped = bedrock.wrap(client) as typeof client;

      const command = createConverseCommand({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        messages: [],
      });

      await expect(wrapped.send(command)).rejects.toThrow('Throttling');

      expect(mockCaptureError).toHaveBeenCalledOnce();
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'bedrock',
          model: 'anthropic.claude-3-haiku-20240307-v1:0',
          streaming: false,
        })
      );
    });

    it('should extract output from response content', async () => {
      const mockSend = vi.fn().mockResolvedValue(
        createConverseResponse({ text: 'Custom response text' })
      );
      const client = createMockBedrockClient(mockSend);
      const wrapped = bedrock.wrap(client) as typeof client;

      const command = createConverseCommand({
        modelId: 'test-model',
        messages: [],
      });

      await wrapped.send(command);

      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          output: 'Custom response text',
        })
      );
    });
  });

  describe('ConverseStreamCommand', () => {
    it('should capture trace after stream completes', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        $metadata: { httpStatusCode: 200 },
        stream: createConverseStream('Hello world'),
      });
      const client = createMockBedrockClient(mockSend);
      const wrapped = bedrock.wrap(client) as typeof client;

      const command = createConverseStreamCommand({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        messages: [],
      });

      const response = (await wrapped.send(command)) as { stream: AsyncIterable<unknown> };
      const chunks: unknown[] = [];

      for await (const event of response.stream) {
        chunks.push(event);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(mockCaptureTrace).toHaveBeenCalledOnce();
      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'bedrock',
          streaming: true,
          status: 'success',
        })
      );
    });

    it('should accumulate text from contentBlockDelta events', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        $metadata: { httpStatusCode: 200 },
        stream: createConverseStream('Test output'),
      });
      const client = createMockBedrockClient(mockSend);
      const wrapped = bedrock.wrap(client) as typeof client;

      const command = createConverseStreamCommand({
        modelId: 'test-model',
        messages: [],
      });

      const response = (await wrapped.send(command)) as { stream: AsyncIterable<unknown> };

      for await (const _ of response.stream) {
        // consume stream
      }

      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          output: expect.stringContaining('Test'),
        })
      );
    });

    it('should capture error if stream fails', async () => {
      const mockSend = vi.fn().mockResolvedValue({
        $metadata: { httpStatusCode: 200 },
        stream: createConverseStreamError(),
      });
      const client = createMockBedrockClient(mockSend);
      const wrapped = bedrock.wrap(client) as typeof client;

      const command = createConverseStreamCommand({
        modelId: 'test-model',
        messages: [],
      });

      const response = (await wrapped.send(command)) as { stream: AsyncIterable<unknown> };

      await expect(async () => {
        for await (const _ of response.stream) {
          // consume stream
        }
      }).rejects.toThrow('Stream interrupted');

      expect(mockCaptureError).toHaveBeenCalledOnce();
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'bedrock',
          streaming: true,
        })
      );
    });
  });

  describe('InvokeModelCommand', () => {
    it('should parse Claude response format', async () => {
      const mockSend = vi.fn().mockResolvedValue(createInvokeModelClaudeResponse());
      const client = createMockBedrockClient(mockSend);
      const wrapped = bedrock.wrap(client) as typeof client;

      const command = createInvokeModelCommand({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
      });

      await wrapped.send(command);

      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          output: 'Hello from Claude!',
          inputTokens: 12,
          outputTokens: 8,
        })
      );
    });

    it('should parse Titan response format', async () => {
      const mockSend = vi.fn().mockResolvedValue(createInvokeModelTitanResponse());
      const client = createMockBedrockClient(mockSend);
      const wrapped = bedrock.wrap(client) as typeof client;

      const command = createInvokeModelCommand({
        modelId: 'amazon.titan-text-express-v1',
        body: JSON.stringify({ inputText: 'Hello' }),
      });

      await wrapped.send(command);

      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          output: 'Hello from Titan!',
          inputTokens: 10,
          outputTokens: 20,
        })
      );
    });

    it('should parse Llama response format', async () => {
      const mockSend = vi.fn().mockResolvedValue(createInvokeModelLlamaResponse());
      const client = createMockBedrockClient(mockSend);
      const wrapped = bedrock.wrap(client) as typeof client;

      const command = createInvokeModelCommand({
        modelId: 'meta.llama2-70b-chat-v1',
        body: JSON.stringify({ prompt: 'Hello' }),
      });

      await wrapped.send(command);

      expect(mockCaptureTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          output: 'Hello from Llama!',
          inputTokens: 8,
          outputTokens: 5,
        })
      );
    });
  });

  describe('pass-through commands', () => {
    it('should not intercept non-LLM commands', async () => {
      const mockSend = vi.fn().mockResolvedValue({ models: [] });
      const client = createMockBedrockClient(mockSend);
      const wrapped = bedrock.wrap(client) as typeof client;

      const command = {
        constructor: { name: 'ListFoundationModelsCommand' },
        input: {},
      };

      await wrapped.send(command);

      expect(mockCaptureTrace).not.toHaveBeenCalled();
      expect(mockCaptureError).not.toHaveBeenCalled();
    });
  });
});
