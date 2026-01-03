/**
 * Provider Registry
 *
 * Manages provider detection and wrapping.
 * Extensible - new providers can be added easily.
 */

import type { ProviderName } from '../core/types';
import * as openai from './openai';
import * as anthropic from './anthropic';

// ─────────────────────────────────────────────────────────────
// Provider Interface
// ─────────────────────────────────────────────────────────────

interface Provider {
  name: ProviderName;
  canHandle: (client: unknown) => boolean;
  wrap: (client: unknown) => unknown;
}

// ─────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────

const providers: Provider[] = [
  {
    name: 'openai',
    canHandle: openai.canHandle,
    wrap: openai.wrap,
  },
  {
    name: 'anthropic',
    canHandle: anthropic.canHandle,
    wrap: anthropic.wrap,
  },
];

/**
 * Register a custom provider
 */
export function registerProvider(provider: Provider): void {
  // Add at beginning so custom providers take precedence
  providers.unshift(provider);
}

/**
 * Detect provider from client instance
 */
export function detectProvider(client: unknown): ProviderName {
  for (const provider of providers) {
    if (provider.canHandle(client)) {
      return provider.name;
    }
  }
  return 'unknown';
}

/**
 * Wrap client with appropriate provider
 */
export function wrapClient<T>(client: T): T {
  for (const provider of providers) {
    if (provider.canHandle(client)) {
      return provider.wrap(client) as T;
    }
  }

  // Unknown provider - return as-is with warning
  console.warn(
    '[Lelemon] Unknown client type. Tracing not enabled. ' +
    'Supported: OpenAI, Anthropic'
  );

  return client;
}
