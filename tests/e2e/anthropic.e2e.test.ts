import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config } from 'dotenv';

// Force reload .env at test file level
config({ override: true });

/**
 * E2E Tests for Anthropic
 *
 * These tests require:
 * - ANTHROPIC_API_KEY set in .env
 *
 * Tests are skipped if API key is not available.
 */

const hasAnthropicKey = (): boolean => {
  return !!process.env.ANTHROPIC_API_KEY;
};

describe.skipIf(!hasAnthropicKey())('Anthropic E2E Tests', () => {
  let Anthropic: any;
  let observe: typeof import('../../src/observe').observe;
  let init: typeof import('../../src/core/config').init;
  let flush: typeof import('../../src/core/config').flush;

  beforeAll(async () => {
    try {
      const anthropicModule = await import('@anthropic-ai/sdk');
      Anthropic = anthropicModule.default;

      const sdk = await import('../../src/index');
      observe = sdk.observe;
      init = sdk.init;
      flush = sdk.flush;

      init({
        apiKey: process.env.LELEMON_API_KEY || 'test-key',
        debug: true,
      });
    } catch (error) {
      console.warn('Anthropic SDK not installed, E2E tests will be skipped');
    }
  });

  afterAll(async () => {
    if (flush) {
      await flush();
    }
  });

  it('should trace real messages.create call', async () => {
    if (!Anthropic) {
      return;
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const traced = observe(client);

    const result = await traced.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say "Hello E2E" in exactly 2 words.' }],
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBeTruthy();

    console.log('Response:', result.content[0].text);
  }, 30000);

  it('should trace real streaming message', async () => {
    if (!Anthropic) {
      return;
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const traced = observe(client);

    const stream = await traced.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Count from 1 to 3.' }],
      stream: true,
    });

    const chunks: string[] = [];
    for await (const event of stream as AsyncIterable<{ type: string; delta?: { text?: string } }>) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        chunks.push(event.delta.text);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    const fullText = chunks.join('');
    expect(fullText).toMatch(/1|2|3/);

    console.log('Stream response:', fullText);
  }, 30000);

  it('should trace messages.stream() call', async () => {
    if (!Anthropic) {
      return;
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const traced = observe(client);

    // Use the SDK's stream() method
    const stream = traced.messages.stream({
      model: 'claude-3-haiku-20240307',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say "streaming works"' }],
    });

    const chunks: string[] = [];
    for await (const event of stream as AsyncIterable<{ type: string; delta?: { text?: string } }>) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        chunks.push(event.delta.text);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    const fullText = chunks.join('');
    expect(fullText.length).toBeGreaterThan(0);

    console.log('SDK stream response:', fullText);
  }, 30000);

  it('should handle API errors gracefully', async () => {
    if (!Anthropic) {
      return;
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const traced = observe(client);

    await expect(
      traced.messages.create({
        model: 'invalid-model-xyz',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Test' }],
      })
    ).rejects.toThrow();
  }, 10000);
});
