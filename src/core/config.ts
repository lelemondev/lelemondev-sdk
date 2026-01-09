/**
 * Global Configuration
 *
 * Manages SDK configuration and transport instance.
 */

import type { LelemonConfig, SDKTelemetry } from './types';
import { Transport } from './transport';
import { setDebug, info, warn, debug } from './logger';
import { buildTelemetry } from './telemetry';

// ─────────────────────────────────────────────────────────────
// Global State
// ─────────────────────────────────────────────────────────────

let globalConfig: LelemonConfig = {};
let globalTransport: Transport | null = null;
let globalTelemetry: SDKTelemetry | null = null;
let initialized = false;

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = 'https://api.lelemon.dev';

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

  // Build telemetry with service config
  globalTelemetry = buildTelemetry(config.service);

  info('Initializing SDK', {
    endpoint: config.endpoint ?? DEFAULT_ENDPOINT,
    debug: config.debug ?? false,
    disabled: config.disabled ?? false,
    telemetry: globalTelemetry,
  });

  globalTransport = createTransport(config);
  initialized = true;

  // Log status after transport is created
  if (globalTransport.isEnabled()) {
    info('SDK initialized - tracing enabled');
  } else {
    debug('SDK initialized - tracing disabled (no API key or explicitly disabled)');
  }
}

/**
 * Get current config
 */
export function getConfig(): LelemonConfig {
  return globalConfig;
}

/**
 * Get SDK telemetry
 */
export function getTelemetry(): SDKTelemetry | null {
  return globalTelemetry;
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
