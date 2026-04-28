/**
 * Wrap any promise with a timeout. If the promise doesn't resolve within
 * `ms` milliseconds, the wrapper rejects with a timeout error. Used to make
 * fetch / Supabase calls fail fast on bad cellular connections instead of
 * hanging forever and leaving spinners on screen.
 */
export async function withTimeout<T>(promise: Promise<T>, ms = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Request timed out')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Wrap a fetch call with a timeout via AbortController. Better than withTimeout
 * for fetch specifically because it cancels the underlying request instead of
 * just abandoning the promise (frees up the network slot).
 */
export async function timeoutFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  ms = 15000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
