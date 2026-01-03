/**
 * Message Parser
 * Auto-detects OpenAI/Anthropic/Gemini message formats and extracts relevant data
 */

import type {
  Message,
  OpenAIMessage,
  OpenAIToolCall,
  AnthropicMessage,
  AnthropicContent,
  ParsedTrace,
  ParsedLLMCall,
  ParsedToolCall,
} from './types';

// ============================================
// GEMINI FORMAT
// ============================================

interface GeminiMessage {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: unknown;
  };
}

/**
 * Detect if messages are in OpenAI format
 */
function isOpenAIFormat(messages: unknown[]): messages is OpenAIMessage[] {
  if (!messages.length) return false;
  const first = messages[0] as Record<string, unknown>;
  // OpenAI has role: system/user/assistant/tool
  return (
    typeof first === 'object' &&
    first !== null &&
    'role' in first &&
    ['system', 'user', 'assistant', 'tool'].includes(first.role as string)
  );
}

/**
 * Detect if messages are in Anthropic format
 */
function isAnthropicFormat(messages: unknown[]): messages is AnthropicMessage[] {
  if (!messages.length) return false;
  const first = messages[0] as Record<string, unknown>;
  // Anthropic only has user/assistant, and content can be array
  return (
    typeof first === 'object' &&
    first !== null &&
    'role' in first &&
    ['user', 'assistant'].includes(first.role as string) &&
    (typeof first.content === 'string' || Array.isArray(first.content))
  );
}

/**
 * Detect if messages are in Gemini format
 */
function isGeminiFormat(messages: unknown[]): messages is GeminiMessage[] {
  if (!messages.length) return false;
  const first = messages[0] as Record<string, unknown>;
  // Gemini uses 'user' | 'model' and has 'parts' array
  return (
    typeof first === 'object' &&
    first !== null &&
    'role' in first &&
    ['user', 'model'].includes(first.role as string) &&
    'parts' in first &&
    Array.isArray(first.parts)
  );
}

/**
 * Parse OpenAI messages
 */
function parseOpenAI(messages: OpenAIMessage[]): ParsedTrace {
  const result: ParsedTrace = {
    llmCalls: [],
    toolCalls: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    models: [],
    provider: 'openai',
  };

  for (const msg of messages) {
    if (msg.role === 'system') {
      result.systemPrompt = msg.content ?? undefined;
    } else if (msg.role === 'user' && !result.userInput) {
      result.userInput = msg.content ?? undefined;
    } else if (msg.role === 'assistant') {
      // Track as LLM call
      const llmCall: ParsedLLMCall = {
        provider: 'openai',
        output: msg.content,
      };

      // Extract tool calls if present
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        llmCall.toolCalls = msg.tool_calls.map((tc: OpenAIToolCall) => ({
          name: tc.function.name,
          input: safeParseJSON(tc.function.arguments),
        }));

        // Also add to global tool calls
        for (const tc of msg.tool_calls) {
          result.toolCalls.push({
            name: tc.function.name,
            input: safeParseJSON(tc.function.arguments),
          });
        }
      }

      result.llmCalls.push(llmCall);

      // Last assistant message is the output
      if (msg.content) {
        result.output = msg.content;
      }
    } else if (msg.role === 'tool') {
      // Find the matching tool call and add output
      const lastToolCall = result.toolCalls[result.toolCalls.length - 1];
      if (lastToolCall) {
        lastToolCall.output = safeParseJSON(msg.content ?? '');
      }
    }
  }

  return result;
}

/**
 * Parse Anthropic messages
 */
function parseAnthropic(messages: AnthropicMessage[]): ParsedTrace {
  const result: ParsedTrace = {
    llmCalls: [],
    toolCalls: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    models: [],
    provider: 'anthropic',
  };

  for (const msg of messages) {
    if (msg.role === 'user') {
      // First user message is input
      if (!result.userInput) {
        if (typeof msg.content === 'string') {
          result.userInput = msg.content;
        } else if (Array.isArray(msg.content)) {
          const textContent = msg.content.find(
            (c: AnthropicContent) => c.type === 'text'
          );
          if (textContent && 'text' in textContent) {
            result.userInput = textContent.text;
          }
        }
      }

      // Check for tool_result in content
      if (Array.isArray(msg.content)) {
        for (const block of msg.content as AnthropicContent[]) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            // Find matching tool call and add result
            const toolCall = result.toolCalls.find(
              (tc) => (tc as unknown as { id?: string }).id === block.tool_use_id
            );
            if (toolCall) {
              toolCall.output = block.content;
            }
          }
        }
      }
    } else if (msg.role === 'assistant') {
      const llmCall: ParsedLLMCall = {
        provider: 'anthropic',
      };

      if (typeof msg.content === 'string') {
        llmCall.output = msg.content;
        result.output = msg.content;
      } else if (Array.isArray(msg.content)) {
        const outputs: string[] = [];
        const toolCalls: ParsedToolCall[] = [];

        for (const block of msg.content as AnthropicContent[]) {
          if (block.type === 'text' && block.text) {
            outputs.push(block.text);
          } else if (block.type === 'tool_use' && block.name) {
            const tc: ParsedToolCall & { id?: string } = {
              name: block.name,
              input: block.input,
            };
            if (block.id) {
              tc.id = block.id;
            }
            toolCalls.push(tc);
            result.toolCalls.push(tc);
          }
        }

        if (outputs.length) {
          llmCall.output = outputs.join('\n');
          result.output = outputs.join('\n');
        }
        if (toolCalls.length) {
          llmCall.toolCalls = toolCalls;
        }
      }

      result.llmCalls.push(llmCall);
    }
  }

  return result;
}

/**
 * Parse Gemini messages
 */
function parseGemini(messages: GeminiMessage[]): ParsedTrace {
  const result: ParsedTrace = {
    llmCalls: [],
    toolCalls: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    models: [],
    provider: 'gemini',
  };

  for (const msg of messages) {
    if (msg.role === 'user') {
      // First user message is input
      if (!result.userInput) {
        const textPart = msg.parts.find((p) => p.text);
        if (textPart?.text) {
          result.userInput = textPart.text;
        }
      }

      // Check for function responses (tool results)
      for (const part of msg.parts) {
        if (part.functionResponse) {
          const toolCall = result.toolCalls.find(
            (tc) => tc.name === part.functionResponse!.name
          );
          if (toolCall) {
            toolCall.output = part.functionResponse.response;
          }
        }
      }
    } else if (msg.role === 'model') {
      const llmCall: ParsedLLMCall = {
        provider: 'gemini',
      };

      const outputs: string[] = [];
      const toolCalls: ParsedToolCall[] = [];

      for (const part of msg.parts) {
        if (part.text) {
          outputs.push(part.text);
        } else if (part.functionCall) {
          const tc: ParsedToolCall = {
            name: part.functionCall.name,
            input: part.functionCall.args,
          };
          toolCalls.push(tc);
          result.toolCalls.push(tc);
        }
      }

      if (outputs.length) {
        llmCall.output = outputs.join('\n');
        result.output = outputs.join('\n');
      }
      if (toolCalls.length) {
        llmCall.toolCalls = toolCalls;
      }

      result.llmCalls.push(llmCall);
    }
  }

  return result;
}

/**
 * Safely parse JSON, returning original string if parsing fails
 */
function safeParseJSON(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

/**
 * Parse messages array and extract structured data
 */
export function parseMessages(messages: unknown): ParsedTrace {
  // Handle null/undefined
  if (!messages) {
    return {
      llmCalls: [],
      toolCalls: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      models: [],
      provider: 'unknown',
    };
  }

  // Ensure it's an array
  if (!Array.isArray(messages)) {
    return {
      llmCalls: [],
      toolCalls: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      models: [],
      provider: 'unknown',
      output: typeof messages === 'string' ? messages : JSON.stringify(messages),
    };
  }

  // Detect format and parse (order matters - Gemini first since it's most specific)
  if (isGeminiFormat(messages)) {
    return parseGemini(messages);
  } else if (isOpenAIFormat(messages)) {
    return parseOpenAI(messages);
  } else if (isAnthropicFormat(messages)) {
    return parseAnthropic(messages);
  }

  // Unknown format - just store as-is
  return {
    llmCalls: [],
    toolCalls: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    models: [],
    provider: 'unknown',
  };
}

/**
 * Extract data from an OpenAI/Anthropic/Bedrock response object
 * This handles the raw API response (not the messages array)
 */
export function parseResponse(response: unknown): Partial<ParsedLLMCall> {
  if (!response || typeof response !== 'object') {
    return {};
  }

  const res = response as Record<string, unknown>;
  const result: Partial<ParsedLLMCall> = {};

  // Extract model
  if ('model' in res) {
    result.model = res.model as string;
  }
  // Bedrock model ID in response
  if ('modelId' in res) {
    result.model = res.modelId as string;
  }

  // Extract usage - handle all formats
  if ('usage' in res && typeof res.usage === 'object' && res.usage !== null) {
    const usage = res.usage as Record<string, number>;
    // OpenAI: prompt_tokens, completion_tokens
    // Anthropic/Bedrock: input_tokens, output_tokens
    result.inputTokens = usage.prompt_tokens ?? usage.input_tokens;
    result.outputTokens = usage.completion_tokens ?? usage.output_tokens;
  }

  // Bedrock Converse API format
  if ('$metadata' in res && 'usage' in res) {
    result.provider = 'bedrock';
  }

  // Bedrock InvokeModel response (parsed body)
  if ('anthropic_version' in res || 'amazon-bedrock-invocationMetrics' in res) {
    result.provider = 'bedrock';
  }

  // Gemini response format
  if ('candidates' in res || 'promptFeedback' in res) {
    result.provider = 'gemini';
    // Gemini usageMetadata
    if ('usageMetadata' in res && typeof res.usageMetadata === 'object' && res.usageMetadata !== null) {
      const usage = res.usageMetadata as Record<string, number>;
      result.inputTokens = usage.promptTokenCount;
      result.outputTokens = usage.candidatesTokenCount;
    }
  }

  // Detect provider from model name
  if (result.model && !result.provider) {
    if (result.model.startsWith('gpt') || result.model.startsWith('o1')) {
      result.provider = 'openai';
    } else if (result.model.startsWith('claude')) {
      result.provider = 'anthropic';
    } else if (result.model.startsWith('gemini')) {
      result.provider = 'gemini';
    } else if (
      result.model.startsWith('anthropic.') ||
      result.model.startsWith('amazon.') ||
      result.model.startsWith('meta.') ||
      result.model.startsWith('cohere.') ||
      result.model.startsWith('mistral.') ||
      result.model.includes(':')  // Bedrock ARN format
    ) {
      result.provider = 'bedrock';
    }
  }

  return result;
}

/**
 * Parse Bedrock InvokeModel response body
 * Call this with the parsed JSON body from Bedrock
 */
export function parseBedrockResponse(body: unknown): Partial<ParsedLLMCall> {
  if (!body || typeof body !== 'object') {
    return {};
  }

  const res = body as Record<string, unknown>;
  const result: Partial<ParsedLLMCall> = { provider: 'bedrock' };

  // Claude on Bedrock
  if ('usage' in res && typeof res.usage === 'object' && res.usage !== null) {
    const usage = res.usage as Record<string, number>;
    result.inputTokens = usage.input_tokens;
    result.outputTokens = usage.output_tokens;
  }

  // Model from invocation metrics
  if ('amazon-bedrock-invocationMetrics' in res) {
    const metrics = res['amazon-bedrock-invocationMetrics'] as Record<string, unknown>;
    if (metrics.inputTokenCount) result.inputTokens = metrics.inputTokenCount as number;
    if (metrics.outputTokenCount) result.outputTokens = metrics.outputTokenCount as number;
  }

  return result;
}
