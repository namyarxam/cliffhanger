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
    // Hard 20s timeout on every Supabase HTTP call. Without this, a stalled
    // request leaves any awaiting query hanging forever and the screen sits
    // on an infinite spinner that doesn't recover until app restart. Errors
    // out via AbortController so caller try/catch fires, loading states flip,
    // and the user can pull-to-refresh / retry.
    fetch: (input, init) => timeoutFetch(input, init, 20000),
  },
});
