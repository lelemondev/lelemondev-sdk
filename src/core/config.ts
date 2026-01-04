/**
 * Global Configuration
 *
 * Manages SDK configuration and transport instance.
 */

import type { LelemonConfig } from './types';
import { Transport } from './transport';
import { setDebug, info, warn } from './logger';

// ─────────────────────────────────────────────────────────────
// Global State
// ─────────────────────────────────────────────────────────────

let globalConfig: LelemonConfig = {};
let globalTransport: Transport | null = null;
let initialized = false;

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = 'https://lelemon.dev';

/**
 * Initialize the SDK
 * Call once at app startup
 */
export function init(config: LelemonConfig = {}): void {
  globalConfig = config;

  // Configure debug mode
  if (config.debug) {
    setDebug(true);
  }

  info('Initializing SDK', {
    endpoint: config.endpoint ?? DEFAULT_ENDPOINT,
    debug: config.debug ?? false,
    disabled: config.disabled ?? false,
  });

  globalTransport = createTransport(config);
  initialized = true;

  info('SDK initialized successfully');
}

/**
 * Get current config
 */
export function getConfig(): LelemonConfig {
  return globalConfig;
}

/**
 * Check if SDK is initialized
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Check if SDK is enabled
 */
export function isEnabled(): boolean {
  return getTransport().isEnabled();
}

// ─────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────

/**
 * Get or create transport instance
 */
export function getTransport(): Transport {
  if (!globalTransport) {
    globalTransport = createTransport(globalConfig);
  }
  return globalTransport;
}

/**
 * Flush all pending traces
 */
export async function flush(): Promise<void> {
  if (globalTransport) {
    await globalTransport.flush();
  }
}

/**
 * Create transport instance
 */
function createTransport(config: LelemonConfig): Transport {
  const apiKey = config.apiKey ?? getEnvVar('LELEMON_API_KEY');

  if (!apiKey && !config.disabled) {
    warn('No API key provided. Set apiKey in init() or LELEMON_API_KEY env var. Tracing disabled.');
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

/**
 * Get environment variable (works in Node and edge)
 */
function getEnvVar(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name];
  }
  return undefined;
}
