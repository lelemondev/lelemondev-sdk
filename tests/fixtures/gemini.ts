// Gemini API Mock Responses

/**
 * Create a mock generateContent result
 */
export function createGenerateContentResult(overrides?: Partial<{
  text: string;
  promptTokenCount: number;
  candidatesTokenCount: number;
  finishReason: string;
}>) {
  const defaults = {
    text: 'Hello! I am Gemini.',
    promptTokenCount: 10,
    candidatesTokenCount: 15,
    finishReason: 'STOP',
  };
  const opts = { ...defaults, ...overrides };

  return {
    response: {
      text: () => opts.text,
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
        totalTokenCount: opts.promptTokenCount + opts.candidatesTokenCount,
      },
    },
  };
}

/**
 * Create a result with function call (tool use)
 */
export function createFunctionCallResult() {
  return {
    response: {
      text: () => {
        throw new Error('Cannot call text() on function call response');
      },
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
    },
  };
}

/**
 * Create a mock streaming result
 */
export function createStreamResult(text = 'Hello streaming world!') {
  const words = text.split(' ');

  async function* createStream() {
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const isLast = i === words.length - 1;

      yield {
        text: () => word + (isLast ? '' : ' '),
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

  return {
    stream: createStream(),
    response: Promise.resolve({
      text: () => text,
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: words.length,
        totalTokenCount: 10 + words.length,
      },
    }),
  };
}

/**
 * Create a stream that errors partway through
 */
export function createStreamWithError() {
  async function* createStream() {
    yield {
      text: () => 'Starting',
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
      text: () => ' to',
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

  const responsePromise = new Promise<never>((_, reject) => {
    // Delay rejection to avoid unhandled rejection in tests
    setTimeout(() => reject(new Error('Stream interrupted')), 100);
  });
  // Catch to prevent unhandled rejection warning
  responsePromise.catch(() => {});

  return {
    stream: createStream(),
    response: responsePromise,
  };
}

/**
 * Create a result with cached content tokens
 */
export function createCachedContentResult(overrides?: Partial<{
  text: string;
  cachedContentTokenCount: number;
}>) {
  const defaults = {
    text: 'Response using cached context',
    cachedContentTokenCount: 1000,
  };
  const opts = { ...defaults, ...overrides };

  return {
    response: {
      text: () => opts.text,
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
    },
  };
}

/**
 * Create a result with thinking tokens (Gemini 2.5 with thinking mode)
 */
export function createThinkingResult(overrides?: Partial<{
  text: string;
  thoughtsTokenCount: number;
}>) {
  const defaults = {
    text: 'After careful consideration...',
    thoughtsTokenCount: 512,
  };
  const opts = { ...defaults, ...overrides };

  return {
    response: {
      text: () => opts.text,
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
    },
  };
}
