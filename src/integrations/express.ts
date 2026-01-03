/**
 * Express Integration
 *
 * Middleware that automatically flushes traces when response finishes.
 *
 * @example
 * import express from 'express';
 * import { createMiddleware } from '@lelemondev/sdk/express';
 *
 * const app = express();
 * app.use(createMiddleware());
 */

import { flush } from '../core/config';

// ─────────────────────────────────────────────────────────────
// Types (minimal to avoid requiring express as dependency)
// ─────────────────────────────────────────────────────────────

interface ExpressRequest {
  [key: string]: unknown;
}

interface ExpressResponse {
  on(event: 'finish' | 'close' | 'error', listener: () => void): this;
  [key: string]: unknown;
}

type NextFunction = (error?: unknown) => void;

type ExpressMiddleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction
) => void;

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────

/**
 * Create Express middleware for automatic trace flushing
 *
 * Flushes traces when the response finishes (after res.send/res.json).
 * This is fire-and-forget and doesn't block the response.
 *
 * @returns Express middleware function
 *
 * @example
 * // Global middleware
 * app.use(createMiddleware());
 *
 * @example
 * // Per-route middleware
 * app.post('/chat', createMiddleware(), async (req, res) => {
 *   res.json({ ok: true });
 * });
 */
export function createMiddleware(): ExpressMiddleware {
  return (_req, res, next) => {
    // Flush when response is finished (after headers + body sent)
    res.on('finish', () => {
      flush().catch(() => {
        // Silently ignore flush errors - fire and forget
      });
    });

    next();
  };
}
