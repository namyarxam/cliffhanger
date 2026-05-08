import { Stack } from 'expo-router';
import { useTheme } from '@/src/providers/ThemeProvider';

export default function OnboardingLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
        animation: 'fade',
      }}
    />
  );
}
