// Converse API Responses

export function createConverseResponse(overrides?: Partial<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
}>) {
  const defaults = {
    text: 'Hello! How can I help you today?',
    inputTokens: 10,
    outputTokens: 15,
    stopReason: 'end_turn',
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
  };
  const opts = { ...defaults, ...overrides };

  return {
    $metadata: { httpStatusCode: 200, requestId: 'test-id' },
    output: {
      message: {
        role: 'assistant',
        content: [{ text: opts.text }],
      },
    },
    usage: {
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      totalTokens: opts.inputTokens + opts.outputTokens,
      cacheReadInputTokens: opts.cacheReadInputTokens,
      cacheWriteInputTokens: opts.cacheWriteInputTokens,
    },
    stopReason: opts.stopReason,
  };
}

export function createConverseToolUseResponse() {
  return {
    $metadata: { httpStatusCode: 200 },
    output: {
      message: {
        role: 'assistant',
        content: [
          { text: 'Let me search for that.' },
          {
            toolUse: {
              toolUseId: 'tool-123',
              name: 'search',
              input: { query: 'weather today' },
            },
          },
        ],
      },
    },
    usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
    stopReason: 'tool_use',
  };
}

// Converse Stream

export async function* createConverseStream(text = 'Hello world!') {
  const words = text.split(' ');

  yield { messageStart: { role: 'assistant' } };
  yield { contentBlockStart: { contentBlockIndex: 0, start: {} } };

  for (const word of words) {
    yield {
      contentBlockDelta: {
        contentBlockIndex: 0,
        delta: { text: word + ' ' },
      },
    };
  }

  yield { contentBlockStop: { contentBlockIndex: 0 } };
  yield { messageStop: { stopReason: 'end_turn' } };
  yield {
    metadata: {
      usage: { inputTokens: 10, outputTokens: words.length },
      metrics: { latencyMs: 150 },
    },
  };
}

export async function* createConverseStreamError() {
  yield { messageStart: { role: 'assistant' } };
  yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'Partial' } } };
  throw new Error('Stream interrupted');
}

// InvokeModel Responses

export function createInvokeModelClaudeResponse(text = 'Hello from Claude!') {
  return {
    $metadata: { httpStatusCode: 200 },
    body: new TextEncoder().encode(JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'anthropic.claude-3-haiku-20240307-v1:0',
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 8 },
    })),
    contentType: 'application/json',
  };
}

export function createInvokeModelTitanResponse(text = 'Hello from Titan!') {
  return {
    $metadata: { httpStatusCode: 200 },
    body: new TextEncoder().encode(JSON.stringify({
      inputTextTokenCount: 10,
      results: [{ tokenCount: 20, outputText: text }],
    })),
  };
}

export function createInvokeModelLlamaResponse(text = 'Hello from Llama!') {
  return {
    $metadata: { httpStatusCode: 200 },
    body: new TextEncoder().encode(JSON.stringify({
      generation: text,
      prompt_token_count: 8,
      generation_token_count: 5,
    })),
  };
}

// InvokeModel Stream

export async function* createInvokeModelStream(text = 'Hello streaming!') {
  const words = text.split(' ');

  // message_start
  yield {
    chunk: {
      bytes: new TextEncoder().encode(JSON.stringify({
        type: 'message_start',
        message: { usage: { input_tokens: 10 } },
      })),
    },
  };

  // content blocks
  for (const word of words) {
    yield {
      chunk: {
        bytes: new TextEncoder().encode(JSON.stringify({
          type: 'content_block_delta',
          delta: { text: word + ' ' },
        })),
      },
    };
  }

  // message_delta with final tokens
  yield {
    chunk: {
      bytes: new TextEncoder().encode(JSON.stringify({
        type: 'message_delta',
        usage: { output_tokens: words.length },
      })),
    },
  };
}
