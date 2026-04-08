import { Stack } from 'expo-router';
import { theme } from '@/src/lib/theme';

// Auth screens use a simple stack navigator (no tabs).
// This layout wraps sign-in and sign-up screens.
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
      }}
    />
  );
}
