import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock capture module BEFORE importing context
const mockCaptureSpan = vi.fn();

vi.mock('../../src/core/capture', () => ({
  captureSpan: (options: unknown) => mockCaptureSpan(options),
  captureTrace: vi.fn(),
  captureError: vi.fn(),
  captureToolSpans: vi.fn(),
  setGlobalContext: vi.fn(),
  getGlobalContext: vi.fn(() => ({})),
}));

// Import after mock setup
import { trace, span, getTraceContext, hasTraceContext, generateId } from '../../src/core/context';

describe('Context Module', () => {
  beforeEach(() => {
    mockCaptureSpan.mockClear();
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });

    it('should generate valid UUID format', () => {
      const id = generateId();

      // UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe('trace()', () => {
    it('should execute function and return result', async () => {
      const result = await trace('test-trace', async () => {
        return 'hello';
      });

      expect(result).toBe('hello');
    });

    it('should provide trace context inside callback', async () => {
      let capturedContext: ReturnType<typeof getTraceContext> | undefined;

      await trace('test-trace', async () => {
        capturedContext = getTraceContext();
        return null;
      });

      expect(capturedContext).toBeDefined();
      expect(capturedContext?.name).toBe('test-trace');
      expect(capturedContext?.traceId).toBeDefined();
      expect(capturedContext?.rootSpanId).toBeDefined();
      expect(capturedContext?.currentSpanId).toBe(capturedContext?.rootSpanId);
    });

    it('should not have context outside trace block', async () => {
      expect(hasTraceContext()).toBe(false);
      expect(getTraceContext()).toBeUndefined();

      await trace('test', async () => {
        expect(hasTraceContext()).toBe(true);
      });

      expect(hasTraceContext()).toBe(false);
    });

    it('should accept options object', async () => {
      let capturedContext: ReturnType<typeof getTraceContext> | undefined;

      await trace(
        {
          name: 'rag-query',
          input: { question: 'What is AI?' },
          metadata: { source: 'test' },
          tags: ['test'],
        },
        async () => {
          capturedContext = getTraceContext();
          return null;
        }
      );

      expect(capturedContext?.name).toBe('rag-query');
      expect(capturedContext?.input).toEqual({ question: 'What is AI?' });
      expect(capturedContext?.metadata).toEqual({ source: 'test' });
      expect(capturedContext?.tags).toEqual(['test']);
    });

    it('should share traceId for nested trace calls', async () => {
      let outerTraceId: string | undefined;
      let innerTraceId: string | undefined;
      let innerParentSpanId: string | undefined;
      let outerCurrentSpanId: string | undefined;

      await trace('outer', async () => {
        const outerContext = getTraceContext();
        outerTraceId = outerContext?.traceId;
        outerCurrentSpanId = outerContext?.currentSpanId;

        await trace('inner', async () => {
          const innerContext = getTraceContext();
          innerTraceId = innerContext?.traceId;
          innerParentSpanId = innerContext?.parentSpanId;
        });
      });

      expect(outerTraceId).toBeDefined();
      expect(innerTraceId).toBe(outerTraceId); // Same trace
      expect(innerParentSpanId).toBe(outerCurrentSpanId); // Nested correctly
    });

    it('should propagate errors', async () => {
      const error = new Error('Test error');

      await expect(
        trace('failing-trace', async () => {
          throw error;
        })
      ).rejects.toThrow('Test error');
    });
  });

  describe('span()', () => {
    it('should capture span inside trace', async () => {
      await trace('test-trace', async () => {
        span({
          type: 'retrieval',
          name: 'pinecone-search',
          input: { query: 'test' },
          output: { count: 5 },
          durationMs: 100,
        });
      });

      expect(mockCaptureSpan).toHaveBeenCalledOnce();
      expect(mockCaptureSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'retrieval',
          name: 'pinecone-search',
          input: { query: 'test' },
          output: { count: 5 },
          durationMs: 100,
          status: 'success',
        })
      );
    });

    it('should include trace context in metadata', async () => {
      let traceId: string | undefined;
      let currentSpanId: string | undefined;

      await trace('test-trace', async () => {
        const ctx = getTraceContext();
        traceId = ctx?.traceId;
        currentSpanId = ctx?.currentSpanId;

        span({
          type: 'tool',
          name: 'calculator',
          input: { a: 1, b: 2 },
          output: 3,
        });
      });

      expect(mockCaptureSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            _traceId: traceId,
            _parentSpanId: currentSpanId,
          }),
        })
      );
    });

    it('should not capture span outside trace (with warning)', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      span({
        type: 'retrieval',
        name: 'test',
        input: {},
        output: {},
      });

      expect(mockCaptureSpan).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('span() called outside of trace()')
      );

      consoleSpy.mockRestore();
    });

    it('should handle error status', async () => {
      await trace('test-trace', async () => {
        span({
          type: 'tool',
          name: 'failing-tool',
          input: {},
          output: null,
          status: 'error',
          errorMessage: 'Tool failed',
        });
      });

      expect(mockCaptureSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          errorMessage: 'Tool failed',
        })
      );
    });

    it('should support all span types', async () => {
      const types: Array<'retrieval' | 'embedding' | 'tool' | 'guardrail' | 'rerank' | 'custom'> = [
        'retrieval',
        'embedding',
        'tool',
        'guardrail',
        'rerank',
        'custom',
      ];

      for (const type of types) {
        mockCaptureSpan.mockClear();

        await trace('test', async () => {
          span({ type, name: `${type}-span`, input: {}, output: {} });
        });

        expect(mockCaptureSpan).toHaveBeenCalledWith(
          expect.objectContaining({ type })
        );
      }
    });

    it('should merge span metadata with trace metadata', async () => {
      await trace(
        {
          name: 'test-trace',
          metadata: { traceLevel: true },
        },
        async () => {
          span({
            type: 'tool',
            name: 'test',
            input: {},
            output: {},
            metadata: { spanLevel: true },
          });
        }
      );

      expect(mockCaptureSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            spanLevel: true,
          }),
        })
      );
    });
  });

  describe('hasTraceContext()', () => {
    it('should return false outside trace', () => {
      expect(hasTraceContext()).toBe(false);
    });

    it('should return true inside trace', async () => {
      await trace('test', async () => {
        expect(hasTraceContext()).toBe(true);
      });
    });
  });
});
