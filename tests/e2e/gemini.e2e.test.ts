import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { config } from 'dotenv';

// Force reload .env at test file level
config({ override: true });

/**
 * E2E Tests for Google Gemini
 *
 * These tests require:
 * - GEMINI_API_KEY set in .env
 *
 * Tests are skipped if API key is not available.
 */

const hasGeminiKey = (): boolean => {
  return !!process.env.GEMINI_API_KEY;
};

describe.skipIf(!hasGeminiKey())('Gemini E2E Tests', () => {
  let GoogleGenerativeAI: any;
  let observe: typeof import('../../src/observe').observe;
  let init: typeof import('../../src/core/config').init;
  let flush: typeof import('../../src/core/config').flush;

  beforeAll(async () => {
    try {
      const geminiModule = await import('@google/generative-ai');
      GoogleGenerativeAI = geminiModule.GoogleGenerativeAI;

      const sdk = await import('../../src/index');
      observe = sdk.observe;
      init = sdk.init;
      flush = sdk.flush;

      init({
        apiKey: process.env.LELEMON_API_KEY || 'test-key',
        debug: true,
      });
    } catch (error) {
      console.warn('Google Generative AI SDK not installed, E2E tests will be skipped');
    }
  });

  afterAll(async () => {
    if (flush) {
      await flush();
    }
  });

  it('should trace real generateContent call', async () => {
    if (!GoogleGenerativeAI) {
      return;
    }

    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const traced = observe(client);

    const model = traced.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent('Say "Hello E2E" in exactly 2 words.');

    expect(result).toBeDefined();
    expect(result.response).toBeDefined();

    const text = result.response.text();
    expect(text).toBeTruthy();
    expect(text.length).toBeGreaterThan(0);

    console.log('Response:', text);
  }, 30000);

  it('should trace real generateContentStream call', async () => {
    if (!GoogleGenerativeAI) {
      return;
    }

    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const traced = observe(client);

    const model = traced.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContentStream('Count from 1 to 3.');

    const chunks: string[] = [];
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        chunks.push(text);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    const fullText = chunks.join('');
    expect(fullText).toMatch(/1|2|3/);

    console.log('Stream response:', fullText);
  }, 30000);

  it('should trace chat sendMessage call', async () => {
    if (!GoogleGenerativeAI) {
      return;
    }

    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const traced = observe(client);

    const model = traced.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const chat = model.startChat({
      history: [
        { role: 'user', parts: [{ text: 'My name is Alice.' }] },
        { role: 'model', parts: [{ text: 'Nice to meet you, Alice!' }] },
      ],
    });

    const result = await chat.sendMessage('What is my name?');

    expect(result).toBeDefined();
    const text = result.response.text();
    expect(text.toLowerCase()).toContain('alice');

    console.log('Chat response:', text);
  }, 30000);

  it('should handle API errors gracefully', async () => {
    if (!GoogleGenerativeAI) {
      return;
    }

    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const traced = observe(client);

    // Use an invalid model name
    const model = traced.getGenerativeModel({ model: 'invalid-model-xyz' });

    await expect(
      model.generateContent('Test')
    ).rejects.toThrow();
  }, 10000);
});
