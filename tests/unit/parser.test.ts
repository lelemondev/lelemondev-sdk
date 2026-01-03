import { describe, it, expect } from 'vitest';
import { parseBedrockResponse, parseResponse } from '../../src/parser';

describe('Parser', () => {
  describe('parseBedrockResponse', () => {
    it('should parse Claude on Bedrock response', () => {
      const body = {
        content: [{ type: 'text', text: 'Hello!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      const result = parseBedrockResponse(body);

      expect(result.provider).toBe('bedrock');
      expect(result.inputTokens).toBe(10);
      expect(result.outputTokens).toBe(5);
    });

    it('should parse response with invocation metrics', () => {
      const body = {
        'amazon-bedrock-invocationMetrics': {
          inputTokenCount: 15,
          outputTokenCount: 20,
        },
      };

      const result = parseBedrockResponse(body);

      expect(result.inputTokens).toBe(15);
      expect(result.outputTokens).toBe(20);
    });

    it('should handle null body', () => {
      expect(parseBedrockResponse(null)).toEqual({});
    });

    it('should handle undefined body', () => {
      expect(parseBedrockResponse(undefined)).toEqual({});
    });

    it('should handle non-object body', () => {
      expect(parseBedrockResponse('string')).toEqual({});
    });
  });

  describe('parseResponse with Bedrock detection', () => {
    it('should detect Bedrock from $metadata', () => {
      const response = {
        $metadata: { httpStatusCode: 200 },
        usage: { inputTokens: 10, outputTokens: 5 },
      };

      const result = parseResponse(response);

      expect(result.provider).toBe('bedrock');
    });

    it('should detect Bedrock from modelId field', () => {
      const response = {
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      };

      const result = parseResponse(response);

      expect(result.model).toBe('anthropic.claude-3-haiku-20240307-v1:0');
      expect(result.provider).toBe('bedrock');
    });

    it('should detect Bedrock from anthropic_version', () => {
      const response = {
        anthropic_version: 'bedrock-2023-05-31',
        content: [{ type: 'text', text: 'Hello' }],
      };

      const result = parseResponse(response);

      expect(result.provider).toBe('bedrock');
    });

    it('should detect Bedrock from model prefix anthropic.*', () => {
      const response = {
        model: 'anthropic.claude-v2',
      };

      const result = parseResponse(response);

      expect(result.provider).toBe('bedrock');
    });

    it('should detect Bedrock from model prefix amazon.*', () => {
      const response = {
        model: 'amazon.titan-text-express-v1',
      };

      const result = parseResponse(response);

      expect(result.provider).toBe('bedrock');
    });

    it('should detect Bedrock from model prefix meta.*', () => {
      const response = {
        model: 'meta.llama2-70b-chat-v1',
      };

      const result = parseResponse(response);

      expect(result.provider).toBe('bedrock');
    });

    it('should detect Bedrock from ARN format', () => {
      const response = {
        model: 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-v2',
      };

      const result = parseResponse(response);

      expect(result.provider).toBe('bedrock');
    });

    it('should extract usage from Bedrock response', () => {
      const response = {
        $metadata: { httpStatusCode: 200 },
        usage: { input_tokens: 25, output_tokens: 50 },
      };

      const result = parseResponse(response);

      expect(result.inputTokens).toBe(25);
      expect(result.outputTokens).toBe(50);
    });
  });
});
