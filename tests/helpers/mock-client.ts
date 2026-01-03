import { vi } from 'vitest';

export function createMockBedrockClient(sendImpl?: ReturnType<typeof vi.fn>) {
  return {
    send: sendImpl || vi.fn(),
    config: { region: 'us-east-1' },
    constructor: { name: 'BedrockRuntimeClient' },
  };
}

export function createMockCommand(name: string, input: Record<string, unknown>) {
  return {
    constructor: { name },
    input,
  };
}

export function createConverseCommand(input: {
  modelId: string;
  messages?: Array<{ role: string; content: Array<{ text?: string }> }>;
  system?: Array<{ text?: string }>;
}) {
  return createMockCommand('ConverseCommand', input);
}

export function createConverseStreamCommand(input: {
  modelId: string;
  messages?: Array<{ role: string; content: Array<{ text?: string }> }>;
}) {
  return createMockCommand('ConverseStreamCommand', input);
}

export function createInvokeModelCommand(input: {
  modelId: string;
  body: string | Uint8Array;
}) {
  return createMockCommand('InvokeModelCommand', input);
}

export function createInvokeModelStreamCommand(input: {
  modelId: string;
  body: string | Uint8Array;
}) {
  return createMockCommand('InvokeModelWithResponseStreamCommand', input);
}

export function createMockOpenAIClient() {
  return {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
    constructor: { name: 'OpenAI' },
  };
}

export function createMockAnthropicClient() {
  return {
    messages: {
      create: vi.fn(),
      stream: vi.fn(),
    },
    constructor: { name: 'Anthropic' },
  };
}
