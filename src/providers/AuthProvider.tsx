import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react-native';
import { supabase, SUPABASE_STORAGE_KEY } from '@/src/lib/supabase';
import { silentCatch } from '@/src/lib/errorLog';
import { withTimeout } from '@/src/lib/network';
import type { UserProfile } from '@/src/lib/types';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  // Force a fresh session-resolve + profile-fetch cycle. AuthGate calls this
  // from its soft-retry timer to recover from a wedged-loading state.
  retryAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
  retryAuth: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// Force-clear the cached `initializePromise` inside auth-js. On cold launch,
// supabase-js fires `_initialize()` synchronously at module load, which awaits
// AsyncStorage.getItem. iOS sandbox migrations after a TestFlight update can
// stall that read — auth-js memoizes the dead promise and every subsequent
// auth call (getSession, setSession, INITIAL_SESSION) queues behind it
// forever. JS-level withTimeout wrappers reject the OUTER promise but the
// inner queue stays poisoned. Nuking the property lets the next call re-run
// _initialize against (presumably now-responsive) AsyncStorage.
function nukeInitializePromise() {
  try {
    (supabase.auth as unknown as { initializePromise: Promise<unknown> | null }).initializePromise = null;
  } catch {
    // best-effort; if the internal property name changes upstream, the rest
    // of the recovery path still routes the user to /sign-in.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();

        if (!error && data) {
          setProfile(data as UserProfile);
          return;
        }

        if (error?.code !== 'PGRST116') {
          silentCatch('auth:fetchProfile')(error);
          return;
        }

        // No profile row — retry once after short delay to handle the
        // handle_new_user() trigger race on fresh signups.
        if (attempt === 0) await new Promise(r => setTimeout(r, 500));
      }

      // Profile still missing after retry = zombie session
      // (user was deleted server-side but this device has a cached session).
      // Sign out so the user lands back on the sign-in screen cleanly.
      silentCatch('auth:zombieSession')(
        new Error('Session references user with no profile row — signing out')
      );
      await supabase.auth.signOut();
    } catch (e) {
      silentCatch('auth:fetchProfile')(e);
    }
  }, []);

  // Cold-launch session restore. Bypasses auth-js's initializePromise by
  // reading AsyncStorage directly first — if AsyncStorage itself is wedged
  // (post-update sandbox migration) we time out fast, nuke the cached
  // initializePromise, and route the user to /sign-in instead of waiting
  // forever on a dead lock chain. Once we have storage data, we hand it to
  // setSession which auth-js can now process against (presumably) responsive
  // storage. Every step is breadcrumbed for production diagnosis.
  const retryAuth = useCallback(async () => {
    setLoading(true);
    Sentry.addBreadcrumb({ category: 'auth', message: 'retryAuth:start' });
    try {
      // Step 1: prove AsyncStorage is responsive by reading the persisted
      // session ourselves. If this rejects in 1500ms, AsyncStorage is the
      // hang point — bail to sign-in.
      Sentry.addBreadcrumb({ category: 'auth', message: 'asyncStorage:start' });
      const raw = await withTimeout(AsyncStorage.getItem(SUPABASE_STORAGE_KEY), 1500);
      Sentry.addBreadcrumb({ category: 'auth', message: 'asyncStorage:done', data: { hasValue: raw != null } });

      if (!raw) {
        Sentry.setUser(null);
        setSession(null);
        return;
      }

      // Step 2: parse the stored session and hand it to auth-js. If
      // initializePromise is alive this resolves; if it's dead behind the
      // wedged read, withTimeout(4000) escapes and we nuke + sign-out.
      const stored = JSON.parse(raw) as { access_token?: string; refresh_token?: string };
      if (!stored.access_token || !stored.refresh_token) {
        Sentry.setUser(null);
        setSession(null);
        return;
      }

      Sentry.addBreadcrumb({ category: 'auth', message: 'setSession:start' });
      const { data, error } = await withTimeout(
        supabase.auth.setSession({
          access_token: stored.access_token,
          refresh_token: stored.refresh_token,
        }),
        4000,
      );
      Sentry.addBreadcrumb({ category: 'auth', message: 'setSession:done', data: { ok: !error && !!data?.session } });

      if (error || !data?.session) {
        nukeInitializePromise();
        Sentry.setUser(null);
        setSession(null);
        return;
      }

      setSession(data.session);
      Sentry.setUser({ id: data.session.user.id, email: data.session.user.email });

      Sentry.addBreadcrumb({ category: 'auth', message: 'fetchProfile:start' });
      await withTimeout(fetchProfile(data.session.user.id), 5000);
      Sentry.addBreadcrumb({ category: 'auth', message: 'fetchProfile:done' });
    } catch (e) {
      nukeInitializePromise();
      silentCatch('auth:retryAuth')(e);
    } finally {
      // Defense-in-depth: regardless of which branch ran, the spinner clears.
      setLoading(false);
    }
  }, [fetchProfile]);

  useEffect(() => {
    retryAuth();

    // INITIAL_SESSION fires on subscribe with the persisted session — but
    // it's gated on the same dead initializePromise. retryAuth owns cold
    // start; we only listen here for explicit auth transitions (sign-in,
    // sign-out, token refresh) that happen during the session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, sess) => {
        if (event === 'INITIAL_SESSION') return;
        setSession(sess);
        if (sess?.user) {
          Sentry.setUser({ id: sess.user.id, email: sess.user.email });
          try {
            await withTimeout(fetchProfile(sess.user.id), 5000);
          } catch (e) {
            silentCatch('auth:onAuthStateChange')(e);
          } finally {
            setLoading(false);
          }
        } else {
          Sentry.setUser(null);
          setProfile(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [retryAuth, fetchProfile]);

  // Re-pull the profile every time the app comes back to the foreground.
  // Without this, settings the user changed on a different device stay
  // stale in the cached profile until next sign-in.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      const s = sessionRef.current;
      if (s?.user) fetchProfile(s.user.id);
    });
    return () => sub.remove();
  }, [fetchProfile]);

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      profile,
      loading,
      signOut,
      refreshProfile: async () => {
        if (session?.user) await fetchProfile(session.user.id);
      },
      retryAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
