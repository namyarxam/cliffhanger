import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { AppState } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react-native';
import { supabase } from '@/src/lib/supabase';
import { silentCatch } from '@/src/lib/errorLog';
import type { UserProfile } from '@/src/lib/types';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get the current session on mount. Without a .catch the rejection
    // (network blip on cold launch, Supabase hiccup) leaves `loading: true`
    // forever and the whole app sits on the auth-gate spinner.
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        if (session?.user) {
          Sentry.setUser({ id: session.user.id, email: session.user.email });
          fetchProfile(session.user.id);
        } else {
          Sentry.setUser(null);
          setLoading(false);
        }
      })
      .catch(e => {
        silentCatch('auth:getSession')(e);
        setLoading(false);
      });

    // Listen for auth changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        if (session?.user) {
          Sentry.setUser({ id: session.user.id, email: session.user.email });
          await fetchProfile(session.user.id);
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
    }}>
      {children}
    </AuthContext.Provider>
  );
}
