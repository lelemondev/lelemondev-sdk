/**
 * Hono Integration
 *
 * Middleware for Hono framework (Cloudflare Workers, Deno, Bun, Node.js).
 * Uses executionCtx.waitUntil() when available for non-blocking flush.
 *
 * @example
 * import { Hono } from 'hono';
 * import { createMiddleware } from '@lelemondev/sdk/hono';
 *
 * const app = new Hono();
 * app.use(createMiddleware());
 */

import { flush } from '../core/config';

// ─────────────────────────────────────────────────────────────
// Types (minimal to avoid requiring hono as dependency)
// ─────────────────────────────────────────────────────────────

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface HonoContext {
  req: {
    raw: Request;
    [key: string]: unknown;
  };
  res: Response | undefined;
  executionCtx?: ExecutionContext;
  [key: string]: unknown;
}

type NextFunction = () => Promise<void>;

type HonoMiddleware = (c: HonoContext, next: NextFunction) => Promise<void>;

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────

/**
 * Create Hono middleware for automatic trace flushing
 *
 * On Cloudflare Workers/Deno Deploy: uses executionCtx.waitUntil() for non-blocking flush
 * On Node.js/Bun: flushes after response (fire-and-forget)
 *
 * @returns Hono middleware function
 *
 * @example
 * import { Hono } from 'hono';
 * import { createMiddleware } from '@lelemondev/sdk/hono';
 *
 * const app = new Hono();
 *
 * // Global middleware
 * app.use(createMiddleware());
 *
 * app.post('/chat', async (c) => {
 *   const openai = observe(new OpenAI());
 *   const result = await openai.chat.completions.create({...});
 *   return c.json(result);
 * });
 *
 * export default app;
 */
export function createMiddleware(): HonoMiddleware {
  return async (c, next) => {
    await next();

    // Use waitUntil if available (Cloudflare Workers, Deno Deploy)
    if (c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(flush());
    } else {
      // Fire-and-forget for Node.js/Bun
      flush().catch(() => {});
    }
  };
}
