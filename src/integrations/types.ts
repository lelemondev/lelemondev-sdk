/**
 * Shared types for framework integrations
 */

/**
 * Options for deferred execution in serverless environments
 */
export interface DeferOptions {
  /**
   * Vercel's waitUntil for non-blocking flush after response
   * @see https://vercel.com/docs/functions/functions-api-reference#waituntil
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Flush function type
 */
export type FlushFn = () => Promise<void>;
