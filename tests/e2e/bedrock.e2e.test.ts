import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config } from 'dotenv';

// Force reload .env at test file level (before SDK loads)
config({ override: true });

/**
 * E2E Tests for AWS Bedrock
 *
 * These tests require:
 * - AWS credentials configured (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or AWS_PROFILE)
 * - AWS_REGION set (or defaults to us-east-1)
 * - Access to Bedrock models
 *
 * Tests are skipped if credentials are not available.
 */

const hasAWSCredentials = (): boolean => {
  return !!(
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_PROFILE ||
    process.env.AWS_SESSION_TOKEN
  );
};

// Build explicit credentials config for AWS SDK
const getAWSConfig = () => {
  const baseConfig: Record<string, unknown> = {
    region: process.env.AWS_REGION || 'us-east-1',
  };

  // Explicitly pass credentials if from .env
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    baseConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      ...(process.env.AWS_SESSION_TOKEN && {
        sessionToken: process.env.AWS_SESSION_TOKEN,
      }),
    };
  }

  return baseConfig;
};

describe.skipIf(!hasAWSCredentials())('Bedrock E2E Tests', () => {
  let BedrockRuntimeClient: unknown;
  let ConverseCommand: unknown;
  let ConverseStreamCommand: unknown;
  let observe: typeof import('../../src/observe').observe;
  let init: typeof import('../../src/core/config').init;
  let flush: typeof import('../../src/core/config').flush;

  beforeAll(async () => {
    // Dynamic imports to avoid errors when SDK not installed
    try {
      const bedrockModule = await import('@aws-sdk/client-bedrock-runtime');
      BedrockRuntimeClient = bedrockModule.BedrockRuntimeClient;
      ConverseCommand = bedrockModule.ConverseCommand;
      ConverseStreamCommand = bedrockModule.ConverseStreamCommand;

      const sdk = await import('../../src/index');
      observe = sdk.observe;
      init = sdk.init;
      flush = sdk.flush;

      init({
        apiKey: process.env.LELEMON_API_KEY || 'test-key',
        debug: true,
      });
    } catch (error) {
      console.warn('AWS Bedrock SDK not installed, E2E tests will be skipped');
    }
  });

  afterAll(async () => {
    if (flush) {
      await flush();
    }
  });

  it('should trace real Converse API call', async () => {
    if (!BedrockRuntimeClient || !ConverseCommand) {
      return;
    }

    const client = new (BedrockRuntimeClient as new (config: unknown) => unknown)(getAWSConfig());

    const traced = observe(client);

    const command = new (ConverseCommand as new (input: unknown) => unknown)({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      messages: [
        {
          role: 'user',
          content: [{ text: 'Say "Hello E2E" in exactly 2 words.' }],
        },
      ],
      inferenceConfig: {
        maxTokens: 50,
        temperature: 0.1,
      },
    });

    const response = await (traced as { send: (cmd: unknown) => Promise<unknown> }).send(command);

    expect(response).toBeDefined();
    expect((response as { $metadata: { httpStatusCode: number } }).$metadata.httpStatusCode).toBe(200);
  }, 30000);

  it('should trace real ConverseStream API call', async () => {
    if (!BedrockRuntimeClient || !ConverseStreamCommand) {
      return;
    }

    const client = new (BedrockRuntimeClient as new (config: unknown) => unknown)(getAWSConfig());

    const traced = observe(client);

    const command = new (ConverseStreamCommand as new (input: unknown) => unknown)({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      messages: [
        {
          role: 'user',
          content: [{ text: 'Count from 1 to 3.' }],
        },
      ],
      inferenceConfig: {
        maxTokens: 50,
      },
    });

    const response = await (traced as { send: (cmd: unknown) => Promise<unknown> }).send(command);
    const chunks: string[] = [];

    const stream = (response as { stream: AsyncIterable<{ contentBlockDelta?: { delta?: { text?: string } } }> }).stream;

    for await (const event of stream) {
      if (event.contentBlockDelta?.delta?.text) {
        chunks.push(event.contentBlockDelta.delta.text);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    const fullText = chunks.join('');
    expect(fullText).toMatch(/1|2|3/);
  }, 30000);

  it('should handle API errors gracefully', async () => {
    if (!BedrockRuntimeClient || !ConverseCommand) {
      return;
    }

    const client = new (BedrockRuntimeClient as new (config: unknown) => unknown)(getAWSConfig());

    const traced = observe(client);

    const command = new (ConverseCommand as new (input: unknown) => unknown)({
      modelId: 'invalid-model-that-does-not-exist',
      messages: [{ role: 'user', content: [{ text: 'Test' }] }],
    });

    await expect(
      (traced as { send: (cmd: unknown) => Promise<unknown> }).send(command)
    ).rejects.toThrow();
  }, 10000);
});
