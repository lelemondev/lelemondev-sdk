/**
 * Transport layer with queue-based batching
 *
 * Features:
 * - Fire-and-forget API (sync enqueue)
 * - Automatic batching (by size or interval)
 * - Single flush promise (no duplicate requests)
 * - Graceful error handling (never crashes caller)
 * - Request timeout protection
 */

import type { CreateTraceRequest, CompleteTraceRequest } from './types';

interface TransportConfig {
  apiKey: string;
  endpoint: string;
  debug: boolean;
  disabled: boolean;
  batchSize?: number;
  flushIntervalMs?: number;
  requestTimeoutMs?: number;
}

interface QueuedTrace {
  type: 'create';
  tempId: string;
  data: CreateTraceRequest;
}

interface QueuedComplete {
  type: 'complete';
  traceId: string;
  data: CompleteTraceRequest;
}

type QueueItem = QueuedTrace | QueuedComplete;

interface BatchPayload {
  creates: Array<{ tempId: string; data: CreateTraceRequest }>;
  completes: Array<{ traceId: string; data: CompleteTraceRequest }>;
}

interface BatchResponse {
  created: Record<string, string>; // tempId -> realId
  errors?: string[];
}

// Pending trace resolution
type TraceResolver = (id: string | null) => void;

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

export class Transport {
  private readonly config: Required<TransportConfig>;
  private queue: QueueItem[] = [];
  private flushPromise: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingResolvers: Map<string, TraceResolver> = new Map();
  private idCounter = 0;

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
   * Enqueue trace creation (returns promise that resolves to trace ID)
   */
  enqueueCreate(data: CreateTraceRequest): Promise<string | null> {
    if (this.config.disabled) {
      return Promise.resolve(null);
    }

    const tempId = this.generateTempId();

    return new Promise((resolve) => {
      this.pendingResolvers.set(tempId, resolve);
      this.enqueue({ type: 'create', tempId, data });
    });
  }

  /**
   * Enqueue trace completion (fire-and-forget)
   */
  enqueueComplete(traceId: string, data: CompleteTraceRequest): void {
    if (this.config.disabled || !traceId) {
      return;
    }

    this.enqueue({ type: 'complete', traceId, data });
  }

  /**
   * Flush all pending items
   * Safe to call multiple times (deduplicates)
   */
  async flush(): Promise<void> {
    // If already flushing, wait for that
    if (this.flushPromise) {
      return this.flushPromise;
    }

    // Nothing to flush
    if (this.queue.length === 0) {
      return;
    }

    // Cancel scheduled flush
    this.cancelScheduledFlush();

    // Take current queue
    const items = this.queue;
    this.queue = [];

    // Execute flush
    this.flushPromise = this.sendBatch(items).finally(() => {
      this.flushPromise = null;
    });

    return this.flushPromise;
  }

  /**
   * Get pending item count (for testing/debugging)
   */
  getPendingCount(): number {
    return this.queue.length;
  }

  // ─────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────

  private generateTempId(): string {
    return `temp_${++this.idCounter}_${Date.now()}`;
  }

  private enqueue(item: QueueItem): void {
    this.queue.push(item);

    if (this.queue.length >= this.config.batchSize) {
      // Batch size reached - flush immediately
      this.flush();
    } else {
      // Schedule flush
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) {
      return; // Already scheduled
    }

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

  private async sendBatch(items: QueueItem[]): Promise<void> {
    // Separate creates and completes
    const payload: BatchPayload = {
      creates: [],
      completes: [],
    };

    for (const item of items) {
      if (item.type === 'create') {
        payload.creates.push({ tempId: item.tempId, data: item.data });
      } else {
        payload.completes.push({ traceId: item.traceId, data: item.data });
      }
    }

    // Skip if nothing to send
    if (payload.creates.length === 0 && payload.completes.length === 0) {
      return;
    }

    this.log('Sending batch', {
      creates: payload.creates.length,
      completes: payload.completes.length
    });

    try {
      const response = await this.request<BatchResponse>(
        'POST',
        '/api/v1/traces/batch',
        payload
      );

      // Resolve pending trace IDs
      if (response.created) {
        for (const [tempId, realId] of Object.entries(response.created)) {
          const resolver = this.pendingResolvers.get(tempId);
          if (resolver) {
            resolver(realId);
            this.pendingResolvers.delete(tempId);
          }
        }
      }

      // Log any errors from server
      if (response.errors?.length && this.config.debug) {
        console.warn('[Lelemon] Batch errors:', response.errors);
      }
    } catch (error) {
      // Resolve all pending creates with null (failed)
      for (const item of items) {
        if (item.type === 'create') {
          const resolver = this.pendingResolvers.get(item.tempId);
          if (resolver) {
            resolver(null);
            this.pendingResolvers.delete(item.tempId);
          }
        }
      }

      this.log('Batch failed', error);
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.config.endpoint}${path}`;
    const controller = new AbortController();

    // Timeout protection
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
      return text ? JSON.parse(text) : ({} as T);
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
