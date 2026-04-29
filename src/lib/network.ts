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
 * Wrap a fetch call with a timeout via AbortController + Promise.race.
 *
 * AbortController alone is unreliable across iOS background/resume cycles:
 * when the app is suspended mid-fetch, the OS can tear down the underlying
 * socket while leaving the JS-side promise in a permanently-pending state.
 * On resume, calling controller.abort() doesn't always propagate back to the
 * promise as a rejection — fetch just sits forever, and any awaiting code
 * (auth check, query) hangs with it.
 *
 * The Promise.race + setTimeout-rejecting branch ensures the JS-side promise
 * always settles within `ms` regardless of fetch's state. AbortController is
 * still wired so the native socket gets cleaned up; we just don't depend on
 * it firing the rejection.
 */
export async function timeoutFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  ms = 15000,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Request timed out'));
    }, ms);
  });
  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
