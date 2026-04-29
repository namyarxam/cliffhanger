import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { timeoutFetch } from './network';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// AsyncStorage adapter for persisting auth sessions on the device.
// This is the React Native equivalent of localStorage — your login
// session survives app restarts.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
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
