import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Link } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';

export default function SignInScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);

  async function handleSignIn() {
    if (!email || !password) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      // Supabase returns "Email not confirmed" when email verification is required.
      if (error.message.toLowerCase().includes('email not confirmed')) {
        setUnverified(true);
        return;
      }
      Alert.alert('Sign in failed', error.message);
      return;
    }
    setUnverified(false);
    // On success, the AuthProvider detects the session change
    // and the root layout redirects to (tabs)
  }

  async function handleResendConfirmation() {
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error) {
      Alert.alert('Could not resend', error.message);
      return;
    }
    Alert.alert('Sent', 'A new confirmation email is on its way.');
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.logo}>
          cliff<Text style={styles.logoAccent}>hanger</Text>
        </Text>
        <Text style={styles.subtitle}>Sign in to your account</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={theme.textFaint}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={theme.textFaint}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
        />

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignIn}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </Pressable>

        {unverified && (
          <View style={styles.unverifiedBox}>
            <Text style={styles.unverifiedText}>
              This account isn't verified yet. Check your inbox for the confirmation link.
            </Text>
            <Pressable style={({ pressed }) => [styles.resendButton, pressed && { opacity: 0.7 }]} onPress={handleResendConfirmation}>
              <Text style={styles.resendText}>Resend confirmation email</Text>
            </Pressable>
          </View>
        )}

        <Link href="/(auth)/forgot-password" asChild>
          <Pressable style={styles.forgotButton}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>
        </Link>

        <Link href="/(auth)/sign-up" asChild>
          <Pressable style={styles.linkButton}>
            <Text style={styles.linkText}>
              Don't have an account? <Text style={styles.linkAccent}>Sign up</Text>
            </Text>
          </Pressable>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    fontSize: 32,
    fontWeight: '700',
    color: theme.text,
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -1,
  },
  logoAccent: {
    color: theme.accent,
  },
  subtitle: {
    fontSize: 14,
    color: theme.textDim,
    textAlign: 'center',
    marginBottom: 40,
  },
  input: {
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: theme.text,
    marginBottom: 14,
  },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  unverifiedBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255,107,53,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,53,0.25)',
  },
  unverifiedText: {
    fontSize: 13,
    color: theme.text,
    lineHeight: 18,
    marginBottom: 10,
  },
  resendButton: {
    alignSelf: 'flex-start',
  },
  resendText: {
    fontSize: 14,
    color: theme.accent,
    fontFamily: 'DMSans_600SemiBold',
  },
  forgotButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  forgotText: {
    color: theme.textDim,
    fontSize: 13,
  },
  linkButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  linkText: {
    color: theme.textDim,
    fontSize: 14,
  },
  linkAccent: {
    color: theme.accent,
    fontWeight: '600',
  },
});
