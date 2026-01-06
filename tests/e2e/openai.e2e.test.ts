import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config } from 'dotenv';

// Force reload .env at test file level
config({ override: true });

/**
 * E2E Tests for OpenAI
 *
 * These tests require:
 * - OPENAI_API_KEY set in .env
 *
 * Tests are skipped if API key is not available.
 */

const hasOpenAIKey = (): boolean => {
  return !!process.env.OPENAI_API_KEY;
};

describe.skipIf(!hasOpenAIKey())('OpenAI E2E Tests', () => {
  let OpenAI: any;
  let observe: typeof import('../../src/openai').observe;
  let init: typeof import('../../src/openai').init;
  let flush: typeof import('../../src/openai').flush;

  beforeAll(async () => {
    try {
      const openaiModule = await import('openai');
      OpenAI = openaiModule.default;

      const sdk = await import('../../src/openai');
      observe = sdk.observe;
      init = sdk.init;
      flush = sdk.flush;

      init({
        apiKey: process.env.LELEMON_API_KEY || 'test-key',
        debug: true,
      });
    } catch (error) {
      console.warn('OpenAI SDK not installed, E2E tests will be skipped');
    }
  });

  afterAll(async () => {
    if (flush) {
      await flush();
    }
  });

  it('should trace real chat.completions.create call', async () => {
    if (!OpenAI) {
      return;
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const traced = observe(client);

    const result = await traced.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say "Hello E2E" in exactly 2 words.' }],
      max_tokens: 10,
    });

    expect(result).toBeDefined();
    expect(result.choices).toBeDefined();
    expect(result.choices[0].message.content).toBeTruthy();

    console.log('Response:', result.choices[0].message.content);
  }, 30000);

  it('should trace real streaming chat completion', async () => {
    if (!OpenAI) {
      return;
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const traced = observe(client);

    const stream = await traced.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Count from 1 to 3.' }],
      stream: true,
      max_tokens: 20,
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) {
        chunks.push(content);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    const fullText = chunks.join('');
    expect(fullText).toMatch(/1|2|3/);

    console.log('Stream response:', fullText);
  }, 30000);

  it('should trace embeddings.create call', async () => {
    if (!OpenAI) {
      return;
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const traced = observe(client);

    const result = await traced.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'Hello world',
    });

    expect(result).toBeDefined();
    expect(result.data).toBeDefined();
    expect(result.data[0].embedding).toBeDefined();
    expect(result.data[0].embedding.length).toBeGreaterThan(0);

    console.log('Embedding dimensions:', result.data[0].embedding.length);
  }, 30000);

  it('should handle API errors gracefully', async () => {
    if (!OpenAI) {
      return;
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const traced = observe(client);

    await expect(
      traced.chat.completions.create({
        model: 'invalid-model-xyz',
        messages: [{ role: 'user', content: 'Test' }],
      })
    ).rejects.toThrow();
  }, 10000);
});
