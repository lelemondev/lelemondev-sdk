/**
 * Lelemon SDK
 * Fire-and-forget LLM observability
 *
 * @example
 * import { init, trace, flush } from '@lelemondev/sdk';
 *
 * // Initialize once
 * init({ apiKey: process.env.LELEMON_API_KEY });
 *
 * // Trace your agent (fire-and-forget, no awaits needed)
 * const t = trace({ input: userMessage });
 * try {
 *   const result = await myAgent(userMessage);
 *   t.success(result.messages);
 * } catch (error) {
 *   t.error(error);
 *   throw error;
 * }
 *
 * // For serverless: flush before response
 * await flush();
 */

// Main API
export { init, trace, flush, isEnabled, Trace } from './tracer';

// Types
export type {
  LelemonConfig,
  TraceOptions,
  Message,
  OpenAIMessage,
  AnthropicMessage,
  ParsedTrace,
  ParsedLLMCall,
  ParsedToolCall,
} from './types';

// Parser (for advanced usage)
export { parseMessages, parseResponse, parseBedrockResponse } from './parser';
