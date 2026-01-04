/**
 * Transport Layer
 *
 * Handles batched HTTP requests to the Lelemon API.
 * Features:
 * - Queue-based batching
 * - Auto-flush on batch size or interval
 * - Request timeout protection
 * - Graceful error handling
 */

import type { CreateTraceRequest } from './types';

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

interface TransportConfig {
  apiKey: string;
  endpoint: string;
  debug: boolean;
  disabled: boolean;
  batchSize?: number;
  flushIntervalMs?: number;
  requestTimeoutMs?: number;
}

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

// ─────────────────────────────────────────────────────────────
// Transport Class
// ─────────────────────────────────────────────────────────────

export class Transport {
  private readonly config: Required<TransportConfig>;
  private queue: CreateTraceRequest[] = [];
  private flushPromise: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: TransportConfig) {
    this.config = {
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      debug: config.debug,
      disabled: config.disabled,
      batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
      flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  /**
   * Check if transport is enabled
   */
  isEnabled(): boolean {
    return !this.config.disabled && !!this.config.apiKey;
  }

  /**
   * Enqueue a trace for sending
   * Fire-and-forget - never blocks
   */
  enqueue(trace: CreateTraceRequest): void {
    if (this.config.disabled) return;

    this.queue.push(trace);

    if (this.queue.length >= this.config.batchSize) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /**
   * Flush all pending traces
   * Safe to call multiple times
   */
  async flush(): Promise<void> {
    if (this.flushPromise) {
      return this.flushPromise;
    }

    if (this.queue.length === 0) {
      return;
    }

    this.cancelScheduledFlush();

    const items = this.queue;
    this.queue = [];

    this.flushPromise = this.sendBatch(items).finally(() => {
      this.flushPromise = null;
    });

    return this.flushPromise;
  }

  /**
   * Get pending count (for debugging)
   */
  getPendingCount(): number {
    return this.queue.length;
  }

  // ─────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.config.flushIntervalMs);
  }

  private cancelScheduledFlush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async sendBatch(items: CreateTraceRequest[]): Promise<void> {
    if (items.length === 0) return;

    this.log(`Sending batch of ${items.length} traces`);

    try {
      await this.request('POST', '/api/v1/ingest', { events: items });
    } catch (error) {
      this.log('Batch send failed', error);
      // Don't rethrow - observability should never crash the app
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.config.endpoint}${path}`;
    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.config.requestTimeoutMs}ms`);
      }

      throw error;
    }
  }

  private log(message: string, data?: unknown): void {
    if (this.config.debug) {
      if (data !== undefined) {
        console.log(`[Lelemon] ${message}`, data);
      } else {
        console.log(`[Lelemon] ${message}`);
      }
    }
  }
}
