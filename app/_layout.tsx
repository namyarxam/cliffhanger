import { useEffect } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Sentry from '@sentry/react-native';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/src/providers/AuthProvider';
import { ThemeProvider, useThemeControl } from '@/src/providers/ThemeProvider';
import { THEMES, type ThemeName } from '@/src/lib/theme';
import { supabase } from '@/src/lib/supabase';
import { silentCatch } from '@/src/lib/errorLog';
import LoaderFlavor from '@/src/components/LoaderFlavor';

// Single QueryClient for the app's lifetime. Defaults tuned for a TV-tracker
// — staleTime keeps cached data "fresh enough" for ~30s so a quick tab
// bounce doesn't refetch; cacheTime holds discarded queries for 5 min so
// returning to a screen rehydrates from memory instead of re-fetching.
// Retries off — we surface failures fast (existing 8s timeoutFetch + the
// query's loading/error states) instead of looping.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: false,
      refetchOnReconnect: 'always',
    },
  },
});

// TanStack Query's foreground/background detection relies on the browser
// Page Visibility API, which doesn't exist in React Native — without this
// bridge, focusManager treats the app as permanently focused, so options
// like refetchIntervalInBackground:false never fire and polling queries
// keep ticking while the app is suspended. Wire AppState into focusManager
// once at module load so every query benefits.
if (Platform.OS !== 'web') {
  focusManager.setEventListener(handleFocus => {
    const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
      handleFocus(status === 'active');
    });
    return () => sub.remove();
  });
}

export { ErrorBoundary } from 'expo-router';

// Sentry error tracking — runs before anything renders so the earliest crash is captured.
if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    debug: __DEV__,
    // Error tracking only for now; performance monitoring off to conserve free-tier budget.
    tracesSampleRate: 0,
    // Sentry sets this to true by default in newer SDKs; we keep it explicit + off so
    // device IPs and other auto-collected PII stay local. Only identified user data
    // we set ourselves via Sentry.setUser() gets sent.
    sendDefaultPii: false,
  });
}

// Keep the splash screen visible while we load fonts + check auth
SplashScreen.preventAutoHideAsync();

/**
 * Handle incoming Supabase auth deep links (password reset, email confirmation).
 * URL shape: cliffhanger://<path>#access_token=...&refresh_token=...&type=<recovery|signup|email_change>
 * We consume the tokens to establish a session, then:
 *   - recovery → push into reset-password screen
 *   - signup / email_change → let AuthGate route into (tabs)
 */
async function handleAuthDeepLink(url: string, router: ReturnType<typeof useRouter>) {
  const fragmentIdx = url.indexOf('#');
  if (fragmentIdx < 0) return;
  const params = new URLSearchParams(url.slice(fragmentIdx + 1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const type = params.get('type');
  if (!accessToken || !refreshToken) return;

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) { silentCatch('deepLink:setSession')(error); return; }
  if (type === 'recovery') router.replace('/(auth)/reset-password');
  // signup/email_change: session is established, AuthGate will route into the app automatically
}

function AuthGate() {
  const { session, profile, loading, retryAuth } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const { themeName, setThemeName } = useThemeControl();

  // Silent auto-recovery for wedged loading. iOS sometimes leaves fetch
  // promises in a permanently-pending state after a sleep/wake cycle —
  // controller.abort() doesn't propagate the rejection, so the spinner
  // sits forever. If we're still loading after 4s, fire a fresh
  // retryAuth() — it spawns new fetches that aren't tied to the dead ones.
  // No copy or button; user just sees the spinner clear when recovery hits.
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      retryAuth().catch(() => {});
    }, 4000);
    return () => clearTimeout(timer);
  }, [loading, retryAuth]);

  // Reconcile DB → ThemeProvider. AsyncStorage gives us an instant first paint
  // on cold boot, but it's per-device. When the profile lands (initial auth
  // resolve, foreground refresh, or sign-in on a new device), prefer the
  // server value so theme follows the user across devices.
  useEffect(() => {
    const dbTheme = profile?.theme;
    if (!dbTheme || !(dbTheme in THEMES)) return;
    if (dbTheme === themeName) return;
    setThemeName(dbTheme as ThemeName);
  }, [profile?.theme, themeName, setThemeName]);

  // Listen for incoming auth deep links (password reset now; email confirmation later)
  useEffect(() => {
    Linking.getInitialURL().then(url => { if (url) handleAuthDeepLink(url, router); });
    const sub = Linking.addEventListener('url', ({ url }) => handleAuthDeepLink(url, router));
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (loading) return;

    // Check if the user is on an auth screen
    const inAuthGroup = segments[0] === '(auth)';
    // Don't bounce users away from the reset screen — they hit it via deep link
    // and have a temporary recovery session that shouldn't trigger the "signed in" redirect.
    const onResetScreen = segments[0] === '(auth)' && segments[1] === 'reset-password';

    if (!session && !inAuthGroup) {
      // Not signed in → redirect to sign-in
      router.replace('/(auth)/sign-in');
    } else if (session && inAuthGroup && !onResetScreen) {
      // Signed in but on auth screen → redirect to main app
      router.replace('/(tabs)');
    }
  }, [session, loading, segments]);

  if (loading) {
    return <LoaderFlavor />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

// Inner shell — runs inside ThemeProvider so it can read the theme. Splash
// stays up until both fonts and the AsyncStorage theme load resolve, so the
// first paint already uses the user's saved palette.
function AppShell() {
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });
  const { ready: themeReady, theme } = useThemeControl();

  useEffect(() => {
    if (fontError) throw fontError;
  }, [fontError]);

  useEffect(() => {
    if (fontsLoaded && themeReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, themeReady]);

  if (!fontsLoaded || !themeReady) return null;

  return (
    <AuthProvider>
      <StatusBar style={theme.statusBarStyle} />
      <AuthGate />
    </AuthProvider>
  );
}

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default Sentry.wrap(RootLayout);
