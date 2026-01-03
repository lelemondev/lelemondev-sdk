/**
 * Lelemon Tracer - Fire-and-forget LLM observability
 *
 * Usage:
 *   const t = trace({ input: userMessage });
 *   try {
 *     const result = await myAgent(userMessage);
 *     t.success(result.messages);
 *   } catch (error) {
 *     t.error(error);
 *     throw error;
 *   }
 *
 * For serverless:
 *   await flush(); // Before response
 */

import { Transport } from './transport';
import { parseMessages, parseResponse } from './parser';
import type {
  LelemonConfig,
  TraceOptions,
  ParsedLLMCall,
} from './types';

const DEFAULT_ENDPOINT = 'https://api.lelemon.dev';

// ─────────────────────────────────────────────────────────────
// Global state
// ─────────────────────────────────────────────────────────────

let globalConfig: LelemonConfig = {};
let globalTransport: Transport | null = null;
let initialized = false;

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Initialize the SDK (optional, will auto-init with env vars)
 *
 * @example
 * init({ apiKey: 'le_xxx' });
 * init({ apiKey: 'le_xxx', debug: true });
 */
export function init(config: LelemonConfig = {}): void {
  globalConfig = config;
  globalTransport = createTransport(config);
  initialized = true;
}

/**
 * Start a new trace
 *
 * @example
 * const t = trace({ input: userMessage });
 * try {
 *   const result = await myAgent(userMessage);
 *   t.success(result.messages);
 * } catch (error) {
 *   t.error(error);
 *   throw error;
 * }
 */
export function trace(options: TraceOptions): Trace {
  const transport = getTransport();
  const debug = globalConfig.debug ?? false;
  const disabled = globalConfig.disabled ?? !transport.isEnabled();

  return new Trace(options, transport, debug, disabled);
}

/**
 * Flush all pending traces to the server
 * Call this before process exit in serverless environments
 *
 * @example
 * // In Next.js API route
 * export async function POST(req: Request) {
 *   // ... your code with traces ...
 *   await flush();
 *   return Response.json(result);
 * }
 *
 * // With Vercel waitUntil
 * import { waitUntil } from '@vercel/functions';
 * waitUntil(flush());
 */
export async function flush(): Promise<void> {
  if (globalTransport) {
    await globalTransport.flush();
  }
}

/**
 * Check if SDK is enabled
 */
export function isEnabled(): boolean {
  return getTransport().isEnabled();
}

// ─────────────────────────────────────────────────────────────
// Trace class
// ─────────────────────────────────────────────────────────────

export class Trace {
  private id: string | null = null;
  private idPromise: Promise<string | null>;
  private readonly transport: Transport;
  private readonly startTime: number;
  private readonly debug: boolean;
  private readonly disabled: boolean;
  private completed = false;
  private llmCalls: ParsedLLMCall[] = [];

  constructor(
    options: TraceOptions,
    transport: Transport,
    debug: boolean,
    disabled: boolean
  ) {
    this.transport = transport;
    this.startTime = Date.now();
    this.debug = debug;
    this.disabled = disabled;

    // Enqueue trace creation immediately
    if (disabled) {
      this.idPromise = Promise.resolve(null);
    } else {
      this.idPromise = transport.enqueueCreate({
        name: options.name,
        sessionId: options.sessionId,
        userId: options.userId,
        input: options.input,
        metadata: options.metadata,
        tags: options.tags,
      });

      // Resolve ID when available (for internal use)
      this.idPromise.then((id) => {
        this.id = id;
      });
    }
  }

  /**
   * Log an LLM response for token tracking
   * Optional - use if you want per-call token counts
   */
  log(response: unknown): this {
    if (this.disabled || this.completed) return this;

    const parsed = parseResponse(response);
    if (parsed.model || parsed.inputTokens || parsed.outputTokens) {
      this.llmCalls.push(parsed);
    }

    return this;
  }

  /**
   * Complete trace successfully (fire-and-forget)
   *
   * @param messages - Full message history (OpenAI/Anthropic format)
   */
  success(messages: unknown): void {
    if (this.completed || this.disabled) return;
    this.completed = true;

    const durationMs = Date.now() - this.startTime;
    const parsed = parseMessages(messages);
    const allLLMCalls = [...this.llmCalls, ...parsed.llmCalls];
    const { totalInputTokens, totalOutputTokens, models } = this.aggregateCalls(allLLMCalls);

    // Wait for ID, then enqueue completion
    this.idPromise.then((id) => {
      if (!id) return;

      this.transport.enqueueComplete(id, {
        status: 'completed',
        output: parsed.output,
        systemPrompt: parsed.systemPrompt,
        llmCalls: allLLMCalls,
        toolCalls: parsed.toolCalls,
        models,
        totalInputTokens,
        totalOutputTokens,
        durationMs,
      });
    });
  }

  /**
   * Complete trace with error (fire-and-forget)
   *
   * @param error - The error that occurred
   * @param messages - Optional message history up to failure
   */
  error(error: Error | unknown, messages?: unknown): void {
    if (this.completed || this.disabled) return;
    this.completed = true;

    const durationMs = Date.now() - this.startTime;
    const parsed = messages ? parseMessages(messages) : null;
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const allLLMCalls = parsed
      ? [...this.llmCalls, ...parsed.llmCalls]
      : this.llmCalls;
    const { totalInputTokens, totalOutputTokens, models } = this.aggregateCalls(allLLMCalls);

    // Wait for ID, then enqueue completion
    this.idPromise.then((id) => {
      if (!id) return;

      this.transport.enqueueComplete(id, {
        status: 'error',
        errorMessage: errorObj.message,
        errorStack: errorObj.stack,
        output: parsed?.output,
        systemPrompt: parsed?.systemPrompt,
        llmCalls: allLLMCalls.length > 0 ? allLLMCalls : undefined,
        toolCalls: parsed?.toolCalls,
        models: models.length > 0 ? models : undefined,
        totalInputTokens,
        totalOutputTokens,
        durationMs,
      });
    });
  }

  /**
   * Get the trace ID (may be null if not yet created or failed)
   */
  getId(): string | null {
    return this.id;
  }

  /**
   * Wait for trace ID to be available
   */
  async waitForId(): Promise<string | null> {
    return this.idPromise;
  }

  // ─────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────

  private aggregateCalls(calls: ParsedLLMCall[]): {
    totalInputTokens: number;
    totalOutputTokens: number;
    models: string[];
  } {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const modelSet = new Set<string>();

    for (const call of calls) {
      if (call.inputTokens) totalInputTokens += call.inputTokens;
      if (call.outputTokens) totalOutputTokens += call.outputTokens;
      if (call.model) modelSet.add(call.model);
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      models: Array.from(modelSet),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

function getTransport(): Transport {
  if (!globalTransport) {
    globalTransport = createTransport(globalConfig);
  }
  return globalTransport;
}

function createTransport(config: LelemonConfig): Transport {
  const apiKey = config.apiKey ?? getEnvVar('LELEMON_API_KEY');

  if (!apiKey && !config.disabled) {
    console.warn(
      '[Lelemon] No API key provided. Set apiKey in config or LELEMON_API_KEY env var. Tracing disabled.'
    );
  }

  return new Transport({
    apiKey: apiKey ?? '',
    endpoint: config.endpoint ?? DEFAULT_ENDPOINT,
    debug: config.debug ?? false,
    disabled: config.disabled ?? !apiKey,
    batchSize: config.batchSize,
    flushIntervalMs: config.flushIntervalMs,
    requestTimeoutMs: config.requestTimeoutMs,
  });
}

function getEnvVar(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name];
  }
  return undefined;
}
