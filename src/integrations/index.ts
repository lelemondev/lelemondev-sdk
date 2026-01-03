/**
 * Framework Integrations
 *
 * Re-exports for convenience. Individual imports are recommended
 * for better tree-shaking.
 *
 * @example
 * // Recommended: import from specific integration
 * import { withObserve } from '@lelemondev/sdk/next';
 *
 * // Alternative: import from integrations
 * import { next, lambda, express, hono } from '@lelemondev/sdk/integrations';
 */

export * as next from './next';
export * as lambda from './lambda';
export * as express from './express';
export * as hono from './hono';
