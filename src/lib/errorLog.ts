import * as Sentry from '@sentry/react-native';

/**
 * Detect the noise floor: aborted fetches, timeouts, "network request failed"
 * errors. These mostly fire when iOS suspends JS while the app is backgrounded
 * and tears down in-flight sockets — they're expected, not actionable, and
 * just bury the real signal in Sentry.
 */
function isExpectedNetworkError(err: unknown): boolean {
  if (err == null) return false;
  const e = err as { name?: string; message?: string; code?: string };
  const name = e.name?.toLowerCase() ?? '';
  if (name === 'aborterror') return true;
  const msg = e.message?.toLowerCase() ?? '';
  if (msg.includes('abort')) return true;
  if (msg.includes('network request failed')) return true;
  if (msg.includes('timed out')) return true;
  // Supabase wraps PostgREST/network errors as { code, details, hint, message }.
  // When the underlying fetch was aborted, message ends up empty and code is '' —
  // that combo only happens for socket-level failures, not real query errors.
  if (msg === '' && (e.code === '' || e.code == null) && 'details' in (err as object)) return true;
  return false;
}

/**
 * Lightweight error logging for non-critical async operations.
 *
 * In dev: warns to the console so issues are visible while coding.
 * In prod: forwards to Sentry with a `context` tag so failures can be
 * filtered by the call site (e.g. tag:show:addWithStatus). Skips obvious
 * background-suspension network noise so the dashboard stays useful.
 */
export function silentCatch(context: string) {
  return (err: unknown) => {
    if (__DEV__) {
      console.warn(`[${context}]`, err);
      return;
    }
    if (isExpectedNetworkError(err)) return;
    Sentry.captureException(err, { tags: { context } });
  };
}
