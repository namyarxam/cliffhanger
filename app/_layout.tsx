import { useEffect } from 'react';
import { View, ActivityIndicator, Linking } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '@/src/providers/AuthProvider';
import { supabase } from '@/src/lib/supabase';
import { silentCatch } from '@/src/lib/errorLog';

import { theme } from '@/src/lib/theme';

export { ErrorBoundary } from 'expo-router';

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
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

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
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  useEffect(() => {
    if (fontError) throw fontError;
  }, [fontError]);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
