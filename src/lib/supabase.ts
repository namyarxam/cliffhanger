import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { timeoutFetch } from './network';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Exported so AuthProvider can read the persisted session DIRECTLY from
// AsyncStorage on cold launch — bypassing auth-js's `initializePromise`
// which gets memoized as dead if the iOS sandbox-migration AsyncStorage
// read stalls during a fresh app update. Whatever value auth-js writes
// here is the same value we'll read out.
export const SUPABASE_STORAGE_KEY = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

// AsyncStorage adapter for persisting auth sessions on the device.
// This is the React Native equivalent of localStorage — your login
// session survives app restarts.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    storageKey: SUPABASE_STORAGE_KEY,
    // EXPERIMENT: was true. Disabling because cold-launch hangs traced to
    // supabase-js firing an auto-refresh on createClient that holds an
    // internal auth mutex while waiting on a slow first network call —
    // every subsequent auth call (retryAuth, AppState handler) queues
    // behind that lock and never resolves until force-quit. Tokens still
    // get refreshed on-demand inside supabase queries when they're near
    // expiry; we just lose the periodic background refresh tick. Revert
    // to true if 401s start showing up on long-running sessions.
    autoRefreshToken: false,
    persistSession: true,
    // Must be false for React Native — Supabase tries to read OAuth
    // tokens from the URL by default, which doesn't work in a native app.
    detectSessionInUrl: false,
  },
  global: {
    // Hard 8s timeout on every Supabase HTTP call. Was 20s but that felt
    // like forever to users staring at a spinner — by the time the timeout
    // fired most testers had already force-killed the app, never seeing the
    // recovery path. 8s is short enough to fail-fast on transient cellular
    // stalls and let the user pull-to-refresh, but generous for legit slow
    // first-load queries. Errors out via AbortController so caller try/catch
    // fires and loading states flip cleanly.
    fetch: (input, init) => timeoutFetch(input, init, 8000),
  },
});
