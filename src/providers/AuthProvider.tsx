import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { AppState } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react-native';
import { supabase } from '@/src/lib/supabase';
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
  // Force a fresh getSession + fetchProfile cycle. Used by AuthGate to escape
  // a wedged-loading state caused by zombie fetch promises that survived an
  // iOS background/resume cycle.
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Run the full session-resolve + profile-fetch cycle. Idempotent — calling
  // it again kicks off fresh network calls regardless of whether a previous
  // attempt is still pending. AuthGate uses it to recover from wedged-loading
  // states (e.g. dead fetch promises after iOS background/resume).
  //
  // Both inner awaits are wrapped in withTimeout so a hung supabase-js promise
  // chain (lock-acquisition stall, AsyncStorage hang, internal refresh retry
  // loop) can't trap the spinner forever. On timeout, the catch flips loading
  // off and AuthGate routes the user to /sign-in — better than infinite spin.
  async function retryAuth() {
    setLoading(true);
    try {
      const { data: { session: s } } = await withTimeout(supabase.auth.getSession(), 3000);
      setSession(s);
      if (s?.user) {
        Sentry.setUser({ id: s.user.id, email: s.user.email });
        await withTimeout(fetchProfile(s.user.id), 5000);
      } else {
        Sentry.setUser(null);
        setLoading(false);
      }
    } catch (e) {
      silentCatch('auth:retryAuth')(e);
      setLoading(false);
    }
  }

  useEffect(() => {
    retryAuth();

    // Listen for auth changes (sign in, sign out, token refresh).
    // INITIAL_SESSION fires once on subscribe with whatever's persisted —
    // this is the path that usually hydrates the cold-launch session.
    // fetchProfile is timeout-wrapped for the same reason as retryAuth:
    // a hung profile query can't trap loading=true forever.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        if (session?.user) {
          Sentry.setUser({ id: session.user.id, email: session.user.email });
          try {
            await withTimeout(fetchProfile(session.user.id), 5000);
          } catch (e) {
            silentCatch('auth:onAuthStateChange')(e);
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
  }, []);

  // Re-pull the profile every time the app comes back to the foreground.
  // Without this, settings the user changed on a different device (e.g.
  // TestFlight build vs local Expo) stay stale in the cached profile until
  // the next sign-in, leading to UI that disagrees with itself across screens.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      const s = sessionRef.current;
      if (s?.user) fetchProfile(s.user.id);
    });
    return () => sub.remove();
  }, []);

  async function fetchProfile(userId: string) {
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
      // Sign out so the user lands back on the sign-in screen cleanly instead
      // of being stuck in an "Anonymous @unknown" loading state.
      silentCatch('auth:zombieSession')(
        new Error('Session references user with no profile row — signing out')
      );
      await supabase.auth.signOut();
    } catch (e) {
      silentCatch('auth:fetchProfile')(e);
    } finally {
      setLoading(false);
    }
  }

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
