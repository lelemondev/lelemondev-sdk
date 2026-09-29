import { describe, it, expect, vi, beforeEach } from 'vitest';

const enqueue = vi.fn();

vi.mock('../../src/core/config', () => ({
  getTransport: () => ({ isEnabled: () => true, enqueue }),
  getTelemetry: () => undefined,
  getConfig: () => ({ disabled: false, debug: false }),
}));

import { captureTrace, captureError, captureSpan } from '../../src/core/capture';
import { trace } from '../../src/core/context';

const base = {
  provider: 'bedrock' as const,
  model: 'model-a',
  input: { messages: [] },
  durationMs: 10,
  status: 'success' as const,
  streaming: false,
};

describe('capture resolves its context per call', () => {
  beforeEach(() => enqueue.mockClear());

  it('takes session, user, metadata and tags from the client context', () => {
    captureTrace({
      ...base,
      context: { sessionId: 's-a', userId: 'u-a', metadata: { org: 'a' }, tags: ['a'] },
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's-a',
        userId: 'u-a',
        tags: ['a'],
        metadata: expect.objectContaining({ org: 'a' }),
      })
    );
  });

  it('a capture without context does not inherit the context of an earlier one', () => {
    captureTrace({ ...base, context: { sessionId: 's-a', metadata: { org: 'a' }, tags: ['a'] } });
    captureTrace(base);

    const [request] = enqueue.mock.calls[1] as [Record<string, unknown>];
    expect(request.sessionId).toBeUndefined();
    expect(request.tags).toBeUndefined();
    expect(request.metadata).not.toHaveProperty('org');
  });

  it('errors resolve the same way', () => {
    captureError({
      provider: 'bedrock',
      model: 'model-a',
      input: {},
      error: new Error('boom'),
      durationMs: 1,
      streaming: false,
      context: { sessionId: 's-a', tags: ['a'] },
    });
    captureError({
      provider: 'bedrock',
      model: 'model-a',
      input: {},
      error: new Error('boom'),
      durationMs: 1,
      streaming: false,
    });

    const [primero, segundo] = enqueue.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(primero).toEqual(expect.objectContaining({ sessionId: 's-a', tags: ['a'] }));
    expect(segundo.sessionId).toBeUndefined();
    expect(segundo.tags).toBeUndefined();
  });

  it('inside a trace, the trace session wins and its tags apply when the client has none', async () => {
    await trace({ name: 'agent', sessionId: 's-trace', tags: ['t'] }, async () => {
      captureTrace(base);
    });

    const llm = enqueue.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((r) => r.model === 'model-a');
    expect(llm).toEqual(expect.objectContaining({ sessionId: 's-trace', tags: ['t'] }));
  });

  it('a manual span outside a trace takes the context it is given', () => {
    captureSpan({
      type: 'tool',
      name: 'lookup',
      input: {},
      output: {},
      durationMs: 1,
      context: { sessionId: 's-a', userId: 'u-a', metadata: { org: 'a' }, tags: ['a'] },
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's-a',
        userId: 'u-a',
        tags: ['a'],
        metadata: expect.objectContaining({ org: 'a' }),
      })
    );
  });

  it('a manual span outside a trace carries no leftover context', () => {
    captureTrace({ ...base, context: { sessionId: 's-a', metadata: { org: 'a' }, tags: ['a'] } });
    captureSpan({ type: 'tool', name: 'lookup', input: {}, output: {}, durationMs: 1 });

    const [, span] = enqueue.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(span.sessionId).toBeUndefined();
    expect(span.tags).toBeUndefined();
    expect(span.metadata).not.toHaveProperty('org');
  });
});
