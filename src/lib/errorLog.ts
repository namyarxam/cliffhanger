/**
 * Lightweight error logging for non-critical async operations.
 *
 * Replaces the bare `.catch(() => {})` pattern so failures are at least
 * visible in the console. Swap the body for a proper error tracker
 * (Sentry, LogRocket, etc.) when ready.
 */
export function silentCatch(context: string) {
  return (err: unknown) => {
    if (__DEV__) {
      console.warn(`[${context}]`, err);
    }
  };
}
