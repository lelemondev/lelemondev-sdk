import type { vi } from 'vitest';

export interface CapturedTrace {
  provider: string;
  model: string;
  input: unknown;
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status: 'success' | 'error';
  streaming: boolean;
  errorMessage?: string;
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export class MockTransport {
  public traces: CapturedTrace[] = [];
  public errors: CapturedTrace[] = [];

  capture(trace: CapturedTrace): void {
    if (trace.status === 'error') {
      this.errors.push(trace);
    }
    this.traces.push(trace);
  }

  getLastTrace(): CapturedTrace | undefined {
    return this.traces[this.traces.length - 1];
  }

  getTraceCount(): number {
    return this.traces.length;
  }

  clear(): void {
    this.traces = [];
    this.errors = [];
  }
}

export function createMockTransport(): MockTransport {
  return new MockTransport();
}
