// Google GenAI (@google/genai) API Mock Responses
// Note: In the new API, .text is a property (not a function)

/**
 * Create a mock generateContent response for the new @google/genai SDK
 */
export function createGenAIGenerateContentResponse(overrides?: Partial<{
  text: string;
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  finishReason: string;
  modelVersion: string;
}>) {
  const defaults = {
    text: 'Hello! I am Gemini.',
    promptTokenCount: 10,
    candidatesTokenCount: 15,
    totalTokenCount: 25,
    finishReason: 'STOP',
    modelVersion: 'gemini-2.0-flash',
  };
  const opts = { ...defaults, ...overrides };

  return {
    text: opts.text,
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: opts.text }],
        },
        finishReason: opts.finishReason,
      },
    ],
    usageMetadata: {
      promptTokenCount: opts.promptTokenCount,
      candidatesTokenCount: opts.candidatesTokenCount,
      totalTokenCount: opts.totalTokenCount,
    },
    modelVersion: opts.modelVersion,
  };
}

/**
 * Create a response with function call (tool use)
 */
export function createGenAIFunctionCallResponse() {
  return {
    text: '',
    candidates: [
      {
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'get_weather',
                args: { location: 'San Francisco', unit: 'celsius' },
              },
            },
          ],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: {
      promptTokenCount: 20,
      candidatesTokenCount: 10,
      totalTokenCount: 30,
    },
    modelVersion: 'gemini-2.0-flash',
  };
}

/**
 * Create a mock streaming result (async iterable of chunks)
 * Note: chunk.text is a property in the new API
 */
export function createGenAIStreamChunks(text = 'Hello streaming world!') {
  const words = text.split(' ');

  async function* createStream() {
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const isLast = i === words.length - 1;

      yield {
        text: word + (isLast ? '' : ' '),
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: word + (isLast ? '' : ' ') }],
            },
          },
        ],
        usageMetadata: isLast
          ? {
              promptTokenCount: 10,
              candidatesTokenCount: words.length,
              totalTokenCount: 10 + words.length,
            }
          : undefined,
      };
    }
  }

  return createStream();
}

/**
 * Create a stream that errors partway through
 */
export function createGenAIStreamWithError() {
  async function* createStream() {
    yield {
      text: 'Starting',
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'Starting' }],
          },
        },
      ],
    };

    yield {
      text: ' to',
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: ' to' }],
          },
        },
      ],
    };

    throw new Error('Stream interrupted');
  }

  return createStream();
}

/**
 * Create a response with cached content tokens
 */
export function createGenAICachedContentResponse(overrides?: Partial<{
  text: string;
  cachedContentTokenCount: number;
}>) {
  const defaults = {
    text: 'Response using cached context',
    cachedContentTokenCount: 1000,
  };
  const opts = { ...defaults, ...overrides };

  return {
    text: opts.text,
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: opts.text }],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: {
      promptTokenCount: 50,
      candidatesTokenCount: 20,
      totalTokenCount: 70,
      cachedContentTokenCount: opts.cachedContentTokenCount,
    },
    modelVersion: 'gemini-2.0-flash',
  };
}

/**
 * Create a response with thinking tokens
 */
export function createGenAIThinkingResponse(overrides?: Partial<{
  text: string;
  thoughtsTokenCount: number;
}>) {
  const defaults = {
    text: 'After careful consideration...',
    thoughtsTokenCount: 512,
  };
  const opts = { ...defaults, ...overrides };

  return {
    text: opts.text,
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: opts.text }],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: {
      promptTokenCount: 30,
      candidatesTokenCount: 25,
      totalTokenCount: 55,
      thoughtsTokenCount: opts.thoughtsTokenCount,
    },
    modelVersion: 'gemini-2.0-flash',
  };
}
