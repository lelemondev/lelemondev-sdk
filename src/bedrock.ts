/**
 * AWS Bedrock Provider Entry Point
 *
 * @example
 * ```typescript
 * import { init, observe, flush } from '@lelemondev/sdk/bedrock';
 * import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
 *
 * init({ apiKey: process.env.LELEMON_API_KEY });
 * const client = observe(new BedrockRuntimeClient({ region: 'us-east-1' }));
 *
 * await client.send(new ConverseCommand({...}));
 * await flush();
 * ```
 */

// Re-export core
export { init, flush, isEnabled } from './core/config';
export { trace, span, getTraceContext } from './core/context';
export { captureSpan } from './core/capture';

// Re-export types
export type {
  LelemonConfig,
  ObserveOptions,
  SpanType,
  CaptureSpanOptions,
} from './core/types';
export type { TraceContext, TraceOptions, SpanOptions } from './core/context';

// Provider-specific observe
import * as bedrock from './providers/bedrock';
import { setGlobalContext } from './core/capture';
import { getConfig } from './core/config';
import type { ObserveOptions } from './core/types';
import { clientWrapped, warn, debug } from './core/logger';

/**
 * Wrap a Bedrock client with automatic tracing
 */
export function observe<T>(client: T, options?: ObserveOptions): T {
  if (options) {
    setGlobalContext(options);
  }

  const config = getConfig();
  if (config.disabled) {
    debug('Tracing disabled, returning unwrapped client');
    return client;
  }

  if (!bedrock.canHandle(client)) {
    warn('Client is not a Bedrock client. Use @lelemondev/sdk/bedrock only with AWS Bedrock SDK.');
    return client;
  }

  clientWrapped('bedrock');
  return bedrock.wrap(client) as T;
}
