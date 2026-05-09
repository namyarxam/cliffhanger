import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, SUPABASE_STORAGE_KEY } from '@/src/lib/supabase';
import { silentCatch } from '@/src/lib/errorLog';
import { withTimeout } from '@/src/lib/network';
import { qk, PERSIST_QUERY_CACHE_KEY } from '@/src/lib/queryKeys';
import { getUserShows } from '@/src/lib/watchlist';
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
  markOnboarded: () => Promise<void>;
  markCoachmarkSeen: (id: string) => Promise<void>;
  resetCoachmarks: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
  retryAuth: async () => {},
  markOnboarded: async () => {},
  markCoachmarkSeen: async () => {},
  resetCoachmarks: async () => {},
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
  const queryClient = useQueryClient();

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();

        if (!error && data) {
          // Defensive: if migration 048 hasn't been applied locally yet, the
          // column won't be returned. Default to [] so the rest of the app
          // can read profile.coachmarks_seen without a null check.
          const safe = { ...data, coachmarks_seen: (data as { coachmarks_seen?: string[] }).coachmarks_seen ?? [] } as UserProfile;
          setProfile(safe);
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
      //
      // Defensive parse: a corrupt value here used to crash boot — the
      // raw SyntaxError would propagate up, the user couldn't open the app,
      // and the bad value persisted across launches because nothing cleared
      // it. Now we catch the parse error, wipe the bad key so the next
      // launch starts clean, and fall through to no-session (sign-in).
      // Same treatment for a parsed-but-malformed shape: clear and bail.
      let stored: { access_token?: string; refresh_token?: string };
      try {
        stored = JSON.parse(raw);
      } catch (parseErr) {
        Sentry.captureException(parseErr, { tags: { context: 'auth:sessionStorageCorrupt' } });
        await AsyncStorage.removeItem(SUPABASE_STORAGE_KEY).catch(silentCatch('auth:clearCorruptSession'));
        Sentry.setUser(null);
        setSession(null);
        return;
      }
      if (!stored || typeof stored !== 'object' || !stored.access_token || !stored.refresh_token) {
        Sentry.captureException(
          new Error('Stored session missing access_token or refresh_token — clearing'),
          { tags: { context: 'auth:sessionStorageMalformed' } },
        );
        await AsyncStorage.removeItem(SUPABASE_STORAGE_KEY).catch(silentCatch('auth:clearMalformedSession'));
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

      // Kick off the My Shows fetch in parallel with fetchProfile. By the
      // time AuthGate routes the user to (tabs)/index, the data is already
      // cached and the screen renders without a spinner. prefetchQuery
      // respects staleTime — if the persister already hydrated fresh data,
      // this is a no-op. Fire-and-forget; silentCatch handles failures so
      // the cold-start path doesn't block on a flaky network.
      const prefetchUserId = data.session.user.id;
      queryClient
        .prefetchQuery({
          queryKey: qk.userShows.all(prefetchUserId),
          queryFn: () => getUserShows(prefetchUserId),
        })
        .catch(silentCatch('auth:prefetchUserShows'));

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
  // Mirror profile to a ref so callbacks can read the latest array without
  // racing React's queued setState. Used by markCoachmarkSeen — see note
  // there for why setProfile's functional-update form is insufficient.
  const profileRef = useRef(profile);
  profileRef.current = profile;
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      const s = sessionRef.current;
      if (s?.user) fetchProfile(s.user.id);
    });
    return () => sub.remove();
  }, [fetchProfile]);

  // Marks the welcome flow complete. Optimistic local update lets AuthGate
  // reroute the moment the user taps "Skip" or finishes adding their first
  // show, even if the network write is still in-flight.
  const markOnboarded = useCallback(async () => {
    const userId = sessionRef.current?.user?.id;
    if (!userId) return;
    const stamp = new Date().toISOString();
    setProfile(prev => (prev ? { ...prev, onboarded_at: stamp } : prev));
    const { error } = await supabase
      .from('profiles')
      .update({ onboarded_at: stamp })
      .eq('id', userId);
    if (error) silentCatch('auth:markOnboarded')(error);
  }, []);

  // Append a coachmark ID to the user's seen list. Optimistic — local state
  // flips first so the overlay dismisses with no flicker, then we commit.
  // Idempotent: re-marking a seen ID is a no-op locally and harmless server-side.
  // We use profileRef for the read because setProfile's functional-update form
  // doesn't run synchronously in React 18 — using `let nextArr` inside that
  // callback to capture the new array would leave nextArr null on the line
  // immediately after, silently skipping the DB write.
  const markCoachmarkSeen = useCallback(async (id: string) => {
    const userId = sessionRef.current?.user?.id;
    const prev = profileRef.current;
    if (!userId || !prev) return;
    if (prev.coachmarks_seen.includes(id)) return;
    const nextArr = [...prev.coachmarks_seen, id];
    setProfile(p => p ? { ...p, coachmarks_seen: nextArr } : p);
    const { error } = await supabase
      .from('profiles')
      .update({ coachmarks_seen: nextArr })
      .eq('id', userId);
    if (error) silentCatch('auth:markCoachmarkSeen')(error);
  }, []);

  // Debug-only: clear the seen list so the user can re-experience every
  // coachmark. Wired to a settings button for in-app testing.
  const resetCoachmarks = useCallback(async () => {
    const userId = sessionRef.current?.user?.id;
    if (!userId) return;
    setProfile(prev => prev ? { ...prev, coachmarks_seen: [] } : prev);
    const { error } = await supabase
      .from('profiles')
      .update({ coachmarks_seen: [] })
      .eq('id', userId);
    if (error) silentCatch('auth:resetCoachmarks')(error);
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    // Wipe every cached query so the next account that signs in (or the
    // sign-in screen itself) doesn't briefly read previous-user data.
    queryClient.clear();
    // Also nuke the persisted disk cache. queryClient.clear() only empties
    // memory; without this, the next launch would rehydrate the prior user's
    // queries from disk before we revalidate. Per-user queryKeys make this
    // defense-in-depth (different userIds wouldn't match anyway), but a
    // shared device with the same Supabase project still benefits.
    AsyncStorage.removeItem(PERSIST_QUERY_CACHE_KEY).catch(silentCatch('auth:clearPersistedCache'));
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
      markOnboarded,
      markCoachmarkSeen,
      resetCoachmarks,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
