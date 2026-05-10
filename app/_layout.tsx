import { useEffect } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import type { ErrorBoundaryProps } from 'expo-router';
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Sentry from '@sentry/react-native';
import * as Notifications from 'expo-notifications';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/src/providers/AuthProvider';
import { TutorialProvider } from '@/src/providers/TutorialProvider';
import { ThemeProvider, useThemeControl } from '@/src/providers/ThemeProvider';
import { THEMES, type ThemeName } from '@/src/lib/theme';
import { supabase } from '@/src/lib/supabase';
import { silentCatch } from '@/src/lib/errorLog';
import LoaderFlavor from '@/src/components/LoaderFlavor';

// Force every Text/TextInput in the app to ignore the user's iOS Dynamic
// Type setting and render at the size we wrote in the stylesheet. Without
// this, users with "Larger Accessibility Sizes" enabled see text scaled
// up to ~310% of default — buttons crop, labels collide, episode timeline
// numbers overflow. Tradeoff: users who legitimately need bigger text
// won't get it from this app (they'd see system-level text grow but ours
// stays put). Acceptable for now; revisit with maxFontSizeMultiplier if
// we want a partial concession.
//
// Set on defaultProps before the first render so every component picks
// it up — even ones that don't pass the prop themselves.
type WithDefaultProps = { defaultProps?: { allowFontScaling?: boolean } };
const TextWithDefaults = Text as unknown as WithDefaultProps;
const TextInputWithDefaults = TextInput as unknown as WithDefaultProps;
TextWithDefaults.defaultProps = { ...TextWithDefaults.defaultProps, allowFontScaling: false };
TextInputWithDefaults.defaultProps = { ...TextInputWithDefaults.defaultProps, allowFontScaling: false };

// Single QueryClient for the app's lifetime. Defaults tuned for a TV-tracker
// — staleTime keeps cached data "fresh enough" for ~30s so a quick tab
// bounce doesn't refetch; gcTime holds discarded queries for 5 min so
// returning to a screen rehydrates from memory instead of re-fetching.
// Retries off — we surface failures fast (existing 8s timeoutFetch + the
// query's loading/error states) instead of looping.
//
// Note: AsyncStorage persistence was tried (commit 3a377e9) and reverted
// after multiple TestFlight users hit "undefined is not a function" boot
// crashes. Hoisting AuthProvider out of AppShell (also from that commit)
// is kept — it's an independent change and was not the regression source.
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

// Custom expo-router ErrorBoundary. When a render error escapes a screen,
// expo-router catches it and renders this component instead of crashing the
// process. The default export from expo-router is silent — it shows
// "Something went wrong" but doesn't notify Sentry, so production crashes
// went unobserved. This version captures the error with a stack-preserving
// tag, surfaces the error message to the user, and offers a Retry that
// re-mounts the route subtree.
//
// Errors that happen ABOVE the route boundary (in providers, in module
// load) are caught by Sentry.wrap() at the bottom of this file. Together
// the two layers cover every JS render path.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { context: 'expo-router:ErrorBoundary' } });
  }, [error]);

  return (
    <View style={errorStyles.container}>
      <Text style={errorStyles.title}>Something went wrong</Text>
      <Text style={errorStyles.message}>{error.message || String(error)}</Text>
      <Pressable
        onPress={() => { retry().catch(() => {}); }}
        style={({ pressed }) => [errorStyles.retry, pressed && { opacity: 0.7 }]}
      >
        <Text style={errorStyles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

// Inline styles — this component must render even if ThemeProvider failed
// or hasn't mounted yet, so it can't depend on the theme context.
const errorStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  message: { color: '#aaa', fontSize: 14, marginBottom: 32, textAlign: 'center' },
  retry: { borderColor: '#fff', borderWidth: 1, borderRadius: 8, paddingHorizontal: 32, paddingVertical: 14 },
  retryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

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

  // Route notification taps. notify-message + notify-invite Edge Functions
  // include `{ type: 'chat' | 'invite', conversation_id }` in the data
  // payload. Chat → open the conversation. Invite → land on the chat list
  // where they accept/decline (we don't open the conversation directly
  // because they aren't a member yet and the screen would 403).
  useEffect(() => {
    const route = (data: unknown) => {
      const d = data as { type?: string; conversation_id?: string } | null;
      if (!d?.conversation_id) return;
      if (d.type === 'chat') router.push(`/(tabs)/chat/${d.conversation_id}`);
      else if (d.type === 'invite') router.push('/(tabs)/chat');
    };
    // Cold-launch case: the OS opened the app via notification tap.
    Notifications.getLastNotificationResponseAsync().then(r => {
      if (r) route(r.notification.request.content.data);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(r => {
      route(r.notification.request.content.data);
    });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (loading) return;

    // Check if the user is on an auth screen
    const inAuthGroup = segments[0] === '(auth)';
    const inOnboardingGroup = segments[0] === '(onboarding)';
    // Don't bounce users away from the reset screen — they hit it via deep link
    // and have a temporary recovery session that shouldn't trigger the "signed in" redirect.
    const onResetScreen = segments[0] === '(auth)' && segments[1] === 'reset-password';

    // Treat onboarding as required only after the profile row has resolved.
    // While `profile` is still null (first paint after sign-in), we don't
    // know yet — so we skip routing this tick and let the next render decide.
    const needsOnboarding = !!session && !!profile && !profile.onboarded_at;

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (session && inAuthGroup && !onResetScreen) {
      // Hold on the auth screen until the profile lands so we route to the
      // right place on the first hop. Without this guard, fresh signups
      // route to (tabs) (because !!profile is briefly false → needsOnboarding
      // is false), then bounce to /(onboarding)/welcome once the profile
      // resolves — flashing the empty-state My Shows screen for a beat.
      if (!profile) return;
      router.replace(profile.onboarded_at ? '/(tabs)' : '/(onboarding)/welcome');
    } else if (needsOnboarding && !inOnboardingGroup) {
      router.replace('/(onboarding)/welcome');
    } else if (session && profile && profile.onboarded_at && inOnboardingGroup) {
      router.replace('/(tabs)');
    }
  }, [session, profile, loading, segments]);

  if (loading) {
    return <LoaderFlavor />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(onboarding)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

// Inner shell — splash stays up until both fonts and the AsyncStorage theme
// load resolve, so the first paint already uses the user's saved palette.
// AuthProvider sits ABOVE this shell so its retryAuth network work runs in
// parallel with font + theme loading instead of waiting for them to finish.
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
    <>
      <StatusBar style={theme.statusBarStyle} />
      <AuthGate />
    </>
  );
}

// Provider order matters:
//   QueryClientProvider — must wrap everything that reads from react-query
//     (AuthProvider's prefetch, every screen).
//   AuthProvider — hoisted to the top so retryAuth fires at module mount,
//     concurrently with font/theme loading. Doesn't read theme.
//   ThemeProvider — wraps Tutorial+AppShell because Coachmark consumes useTheme.
//   TutorialProvider — needs both auth (profile.coachmarks_seen) and theme
//     (Coachmark visuals), so it sits inside both.
function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <TutorialProvider>
            <AppShell />
          </TutorialProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default Sentry.wrap(RootLayout);
