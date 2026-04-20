import * as Sentry from '@sentry/react-native';

/**
 * Lightweight error logging for non-critical async operations.
 *
 * In dev: warns to the console so issues are visible while coding.
 * In prod: forwards to Sentry with a `context` tag so failures can be
 * filtered by the call site (e.g. tag:show:addWithStatus).
 */
export function silentCatch(context: string) {
  return (err: unknown) => {
    if (__DEV__) {
      console.warn(`[${context}]`, err);
      return;
    }
    Sentry.captureException(err, { tags: { context } });
  };
}
