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

/**
 * Minimal Express request type (avoids requiring express as dependency)
 */
export interface ExpressRequest {
  [key: string]: unknown;
}

/**
 * Minimal Express response type (avoids requiring express as dependency)
 */
export interface ExpressResponse {
  on(event: 'finish' | 'close' | 'error', listener: () => void): this;
  [key: string]: unknown;
}

/**
 * Express next function type
 */
export type ExpressNextFunction = (error?: unknown) => void;

/**
 * Express middleware function type
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Next function to pass control
 */
export type ExpressMiddleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: ExpressNextFunction
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
