// OpenAI API Mock Responses

/**
 * Create a mock chat completion response
 */
export function createChatCompletionResponse(overrides?: Partial<{
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  finishReason: string;
}>) {
  const defaults = {
    content: 'Hello! How can I help you today?',
    model: 'gpt-4o-mini',
    promptTokens: 10,
    completionTokens: 15,
    finishReason: 'stop',
  };
  const opts = { ...defaults, ...overrides };

  return {
    id: 'chatcmpl-test-123',
    object: 'chat.completion',
    created: Date.now(),
    model: opts.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: opts.content,
        },
        finish_reason: opts.finishReason,
      },
    ],
    usage: {
      prompt_tokens: opts.promptTokens,
      completion_tokens: opts.completionTokens,
      total_tokens: opts.promptTokens + opts.completionTokens,
    },
  };
}

/**
 * Create a mock chat completion with tool calls
 */
export function createToolCallResponse() {
  return {
    id: 'chatcmpl-test-tool',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_abc123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location":"San Francisco","unit":"celsius"}',
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 25,
      total_tokens: 45,
    },
  };
}

/**
 * Create a mock streaming response
 */
export function createStreamingResponse(text = 'Hello streaming world!') {
  const words = text.split(' ');

  async function* createStream() {
    // Initial chunk with role
    yield {
      id: 'chatcmpl-stream',
      object: 'chat.completion.chunk',
      created: Date.now(),
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null,
        },
      ],
    };

    // Content chunks
    for (const word of words) {
      yield {
        id: 'chatcmpl-stream',
        object: 'chat.completion.chunk',
        created: Date.now(),
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            delta: { content: word + ' ' },
            finish_reason: null,
          },
        ],
      };
    }

    // Final chunk with finish reason and usage
    yield {
      id: 'chatcmpl-stream',
      object: 'chat.completion.chunk',
      created: Date.now(),
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: words.length,
        total_tokens: 10 + words.length,
      },
    };
  }

  const stream = createStream();
  // Add Symbol.asyncIterator to make it async iterable
  return {
    [Symbol.asyncIterator]: () => stream,
  };
}

/**
 * Create a streaming response that errors
 */
export function createStreamingErrorResponse() {
  async function* createStream() {
    yield {
      id: 'chatcmpl-stream',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'Starting' }, finish_reason: null }],
    };

    yield {
      id: 'chatcmpl-stream',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: ' to' }, finish_reason: null }],
    };

    throw new Error('Stream interrupted');
  }

  const stream = createStream();
  return {
    [Symbol.asyncIterator]: () => stream,
  };
}

/**
 * Create a mock legacy completion response
 */
export function createCompletionResponse(overrides?: Partial<{
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}>) {
  const defaults = {
    text: 'This is a completion.',
    model: 'gpt-3.5-turbo-instruct',
    promptTokens: 5,
    completionTokens: 10,
  };
  const opts = { ...defaults, ...overrides };

  return {
    id: 'cmpl-test-123',
    object: 'text_completion',
    created: Date.now(),
    model: opts.model,
    choices: [
      {
        text: opts.text,
        index: 0,
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: opts.promptTokens,
      completion_tokens: opts.completionTokens,
      total_tokens: opts.promptTokens + opts.completionTokens,
    },
  };
}

/**
 * Create a mock embeddings response
 */
export function createEmbeddingsResponse(overrides?: Partial<{
  dimensions: number;
  model: string;
  promptTokens: number;
}>) {
  const defaults = {
    dimensions: 1536,
    model: 'text-embedding-3-small',
    promptTokens: 8,
  };
  const opts = { ...defaults, ...overrides };

  // Generate fake embedding vector
  const embedding = Array(opts.dimensions).fill(0).map(() => Math.random() * 2 - 1);

  return {
    object: 'list',
    data: [
      {
        object: 'embedding',
        embedding,
        index: 0,
      },
    ],
    model: opts.model,
    usage: {
      prompt_tokens: opts.promptTokens,
      total_tokens: opts.promptTokens,
    },
  };
}
