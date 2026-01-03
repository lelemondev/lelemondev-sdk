/**
 * Next.js App Router Integration
 *
 * Wraps route handlers to automatically flush traces.
 * Supports Next.js 15+ `after()` and Vercel's `waitUntil()`.
 *
 * @example
 * import { withObserve } from '@lelemondev/sdk/next';
 *
 * export const POST = withObserve(async (req) => {
 *   const openai = observe(new OpenAI());
 *   const result = await openai.chat.completions.create({...});
 *   return Response.json(result);
 * });
 */

import { flush } from '../core/config';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type NextRouteHandler<TContext = unknown> = (
  request: Request,
  context?: TContext
) => Response | Promise<Response>;

/**
 * Options for the Next.js wrapper
 */
export interface NextObserveOptions {
  /**
   * Next.js 15+ after() function from 'next/server'
   * Preferred method - runs after response without blocking
   *
   * @example
   * import { after } from 'next/server';
   * export const POST = withObserve(handler, { after });
   */
  after?: (callback: () => void | Promise<void>) => void;

  /**
   * Vercel's waitUntil() from '@vercel/functions'
   * Alternative for Vercel deployments
   *
   * @example
   * import { waitUntil } from '@vercel/functions';
   * export const POST = withObserve(handler, { waitUntil });
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

// ─────────────────────────────────────────────────────────────
// Wrapper
// ─────────────────────────────────────────────────────────────

/**
 * Wrap a Next.js App Router handler with automatic trace flushing
 *
 * @param handler - Your route handler function
 * @param options - Optional: pass `after` (Next.js 15+) or `waitUntil` (Vercel)
 * @returns Wrapped handler that auto-flushes traces
 *
 * @example
 * // Basic usage (blocking flush)
 * export const POST = withObserve(async (req) => {
 *   return Response.json({ ok: true });
 * });
 *
 * @example
 * // Next.js 15+ with after() - non-blocking (recommended)
 * import { after } from 'next/server';
 *
 * export const POST = withObserve(
 *   async (req) => Response.json({ ok: true }),
 *   { after }
 * );
 *
 * @example
 * // Vercel with waitUntil() - non-blocking
 * import { waitUntil } from '@vercel/functions';
 *
 * export const POST = withObserve(
 *   async (req) => Response.json({ ok: true }),
 *   { waitUntil }
 * );
 */
export function withObserve<TContext = unknown>(
  handler: NextRouteHandler<TContext>,
  options?: NextObserveOptions
): NextRouteHandler<TContext> {
  return async (request: Request, context?: TContext): Promise<Response> => {
    try {
      return await handler(request, context);
    } finally {
      // Priority: after() > waitUntil() > blocking flush
      if (options?.after) {
        // Next.js 15+ native - best option
        options.after(() => flush());
      } else if (options?.waitUntil) {
        // Vercel platform
        options.waitUntil(flush());
      } else {
        // Fallback: blocking flush
        await flush();
      }
    }
  };
}

/**
 * Create a pre-configured wrapper with default options
 *
 * @example
 * import { after } from 'next/server';
 * import { createWrapper } from '@lelemondev/sdk/next';
 *
 * const withObserve = createWrapper({ after });
 *
 * export const POST = withObserve(async (req) => {
 *   return Response.json({ ok: true });
 * });
 */
export function createWrapper(defaultOptions: NextObserveOptions) {
  return function <TContext = unknown>(
    handler: NextRouteHandler<TContext>,
    options?: NextObserveOptions
  ): NextRouteHandler<TContext> {
    return withObserve(handler, { ...defaultOptions, ...options });
  };
}
