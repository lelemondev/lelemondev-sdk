/**
 * Anthropic test fixtures
 */

import { vi } from 'vitest';

// ─────────────────────────────────────────────────────────────
// Response Fixtures
// ─────────────────────────────────────────────────────────────

export function createMessageResponse(overrides?: {
  content?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}) {
  return {
    id: 'msg_123',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: overrides?.content ?? 'Hello! How can I help you today?',
      },
    ],
    model: overrides?.model ?? 'claude-3-haiku-20240307',
    stop_reason: 'end_turn',
    usage: {
      input_tokens: overrides?.inputTokens ?? 10,
      output_tokens: overrides?.outputTokens ?? 15,
    },
  };
}

export function createToolUseResponse(overrides?: {
  toolName?: string;
  toolInput?: Record<string, unknown>;
}) {
  return {
    id: 'msg_456',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_123',
        name: overrides?.toolName ?? 'get_weather',
        input: overrides?.toolInput ?? { location: 'San Francisco' },
      },
    ],
    model: 'claude-3-haiku-20240307',
    stop_reason: 'tool_use',
    usage: {
      input_tokens: 25,
      output_tokens: 30,
    },
  };
}

export function createMultiBlockResponse() {
  return {
    id: 'msg_789',
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'text', text: 'Here is the analysis:' },
      { type: 'text', text: '\n\nThe data shows...' },
    ],
    model: 'claude-3-haiku-20240307',
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 50,
      output_tokens: 40,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Streaming Fixtures
// ─────────────────────────────────────────────────────────────

export function createStreamingResponse(text = 'Hello streaming world!') {
  const chunks = text.split(' ');

  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_stream_123',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-3-haiku-20240307',
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
    ...chunks.map((word, i) => ({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: i === 0 ? word : ` ${word}` },
    })),
    {
      type: 'content_block_stop',
      index: 0,
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: chunks.length * 2 },
    },
    {
      type: 'message_stop',
    },
  ];

  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
    },
  };
}

export function createStreamWithError() {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_err_123',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-3-haiku-20240307',
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Starting...' },
    },
  ];

  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
      throw new Error('Stream interrupted');
    },
  };
}

// Anthropic SDK's stream() returns a Stream object with additional methods
export function createAnthropicStreamObject(text = 'Hello from stream!') {
  const chunks = text.split(' ');

  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_sdk_stream',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-3-haiku-20240307',
        usage: { input_tokens: 12, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
    ...chunks.map((word, i) => ({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: i === 0 ? word : ` ${word}` },
    })),
    {
      type: 'content_block_stop',
      index: 0,
    },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: chunks.length * 2 },
    },
    {
      type: 'message_stop',
    },
  ];

  const streamObj = {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
    },
    finalMessage: vi.fn().mockResolvedValue({
      id: 'msg_sdk_stream',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'claude-3-haiku-20240307',
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: chunks.length * 2 },
    }),
  };

  return streamObj;
}

// ─────────────────────────────────────────────────────────────
// Mock Client Factory
// ─────────────────────────────────────────────────────────────

export function createMockAnthropicClient(options?: {
  createResponse?: unknown;
  streamResponse?: unknown;
}) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue(options?.createResponse ?? createMessageResponse()),
      stream: vi.fn().mockReturnValue(options?.streamResponse ?? createAnthropicStreamObject()),
    },
    constructor: { name: 'Anthropic' },
  };
}
