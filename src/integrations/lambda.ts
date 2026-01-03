/**
 * AWS Lambda Integration
 *
 * Wraps Lambda handlers to automatically flush traces before the function exits.
 *
 * @example
 * import { withObserve } from '@lelemondev/sdk/lambda';
 *
 * export const handler = withObserve(async (event) => {
 *   const openai = observe(new OpenAI());
 *   const result = await openai.chat.completions.create({...});
 *   return { statusCode: 200, body: JSON.stringify(result) };
 * });
 */

import { flush } from '../core/config';

// ─────────────────────────────────────────────────────────────
// Types (minimal to avoid requiring @types/aws-lambda)
// ─────────────────────────────────────────────────────────────

/**
 * AWS Lambda Context object
 */
export interface LambdaContext {
  functionName: string;
  functionVersion: string;
  invokedFunctionArn: string;
  memoryLimitInMB: string;
  awsRequestId: string;
  logGroupName: string;
  logStreamName: string;
  getRemainingTimeInMillis(): number;
  [key: string]: unknown;
}

/**
 * Generic AWS Lambda handler type
 *
 * @typeParam TEvent - The event type (e.g., APIGatewayProxyEvent)
 * @typeParam TResult - The result type (e.g., APIGatewayProxyResult)
 */
export type LambdaHandler<TEvent = unknown, TResult = unknown> = (
  event: TEvent,
  context: LambdaContext
) => Promise<TResult>;

// ─────────────────────────────────────────────────────────────
// Wrapper
// ─────────────────────────────────────────────────────────────

/**
 * Wrap an AWS Lambda handler with automatic trace flushing
 *
 * Always flushes before returning - Lambda freezes the container
 * immediately after the handler returns, so this is required.
 *
 * @param handler - Your Lambda handler function
 * @returns Wrapped handler that auto-flushes traces
 *
 * @example
 * // API Gateway event
 * export const handler = withObserve(async (event) => {
 *   const body = JSON.parse(event.body);
 *   const openai = observe(new OpenAI());
 *   const result = await openai.chat.completions.create({
 *     model: 'gpt-4',
 *     messages: [{ role: 'user', content: body.message }],
 *   });
 *   return {
 *     statusCode: 200,
 *     body: JSON.stringify(result.choices[0].message),
 *   };
 * });
 *
 * @example
 * // With typed events
 * import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
 *
 * export const handler = withObserve<APIGatewayProxyEvent, APIGatewayProxyResult>(
 *   async (event, context) => {
 *     return { statusCode: 200, body: 'OK' };
 *   }
 * );
 */
export function withObserve<TEvent = unknown, TResult = unknown>(
  handler: LambdaHandler<TEvent, TResult>
): LambdaHandler<TEvent, TResult> {
  return async (event: TEvent, context: LambdaContext): Promise<TResult> => {
    try {
      return await handler(event, context);
    } finally {
      // Always flush - Lambda freezes immediately after return
      await flush();
    }
  };
}
