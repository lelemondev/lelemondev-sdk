/**
 * Lelemon SDK
 * Automatic LLM observability
 *
 * @example
 * import { init, observe, flush } from '@lelemondev/sdk';
 * import OpenAI from 'openai';
 *
 * // Initialize once
 * init({ apiKey: process.env.LELEMON_API_KEY });
 *
 * // Wrap your client - all calls are traced automatically
 * const openai = observe(new OpenAI());
 *
 * // Use normally - no code changes needed
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 *
 * // For serverless: flush before response
 * await flush();
 */

// ─────────────────────────────────────────────────────────────
// Main API
// ─────────────────────────────────────────────────────────────

// Configuration
export { init, flush, isEnabled } from './core/config';

// Observe (primary API)
export { observe, createObserve } from './observe';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type {
  LelemonConfig,
  ObserveOptions,
  ProviderName,
} from './core/types';

