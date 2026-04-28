import { Stack } from 'expo-router';
import { useTheme } from '@/src/providers/ThemeProvider';

// Auth screens use a simple stack navigator (no tabs).
// This layout wraps sign-in and sign-up screens.
export default function AuthLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
      }}
    />
  );
}
