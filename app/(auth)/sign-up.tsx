import { useState } from 'react';
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
  ScrollView,
  Linking,
} from 'react-native';
import { Link } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { theme } from '@/src/lib/theme';

const PRIVACY_URL = 'https://namyarxam.github.io/cliffhanger-docs/privacy';

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  async function handleSignUp() {
    if (!email || !password || !username) {
      Alert.alert('Missing fields', 'Please fill in all required fields.');
      return;
    }

    if (username.length < 3) {
      Alert.alert('Username too short', 'Username must be at least 3 characters.');
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName || username,
          username: username.toLowerCase().replace(/[^a-z0-9_]/g, ''),
        },
      },
    });
    setLoading(false);

    if (error) {
      Alert.alert('Sign up failed', error.message);
      return;
    }

    // If email confirmation is required, no session is returned.
    // Hold the user on a "check your inbox" screen until they click the email link.
    if (!data.session) {
      setAwaitingConfirmation(true);
    }
    // Otherwise, AuthProvider detects the session and AuthGate redirects to (tabs).
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
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.logo}>
          cliff<Text style={styles.logoAccent}>hanger</Text>
        </Text>
        <Text style={styles.subtitle}>
          {awaitingConfirmation ? 'Check your email' : 'Create your account'}
        </Text>

        {awaitingConfirmation ? (
          <>
            <Text style={styles.confirmBody}>
              We sent a confirmation link to <Text style={styles.confirmEmail}>{email}</Text>. Open it on this device to finish signing up.
            </Text>
            <Pressable style={styles.button} onPress={handleResendConfirmation}>
              <Text style={styles.buttonText}>Resend email</Text>
            </Pressable>
            <Link href="/(auth)/sign-in" asChild>
              <Pressable style={styles.linkButton}>
                <Text style={styles.linkText}>
                  Already confirmed? <Text style={styles.linkAccent}>Sign in</Text>
                </Text>
              </Pressable>
            </Link>
          </>
        ) : (
          <>
        <TextInput
          style={styles.input}
          placeholder="Username *"
          placeholderTextColor={theme.textFaint}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoComplete="username-new"
        />

        <TextInput
          style={styles.input}
          placeholder="Display name"
          placeholderTextColor={theme.textFaint}
          value={displayName}
          onChangeText={setDisplayName}
          autoComplete="name"
        />

        <TextInput
          style={styles.input}
          placeholder="Email *"
          placeholderTextColor={theme.textFaint}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />

        <TextInput
          style={styles.input}
          placeholder="Password *"
          placeholderTextColor={theme.textFaint}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password-new"
        />

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignUp}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Create Account</Text>
          )}
        </Pressable>

        <Text style={styles.disclaimer}>
          By creating an account, you agree to our{' '}
          <Text style={styles.disclaimerLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
            Privacy Policy
          </Text>
          .
        </Text>

        <Link href="/(auth)/sign-in" asChild>
          <Pressable style={styles.linkButton}>
            <Text style={styles.linkText}>
              Already have an account? <Text style={styles.linkAccent}>Sign in</Text>
            </Text>
          </Pressable>
        </Link>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  inner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
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
  disclaimer: {
    marginTop: 16,
    fontSize: 12,
    color: theme.textFaint,
    textAlign: 'center',
    lineHeight: 17,
  },
  confirmBody: {
    fontSize: 14,
    color: theme.textDim,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  confirmEmail: {
    color: theme.text,
    fontFamily: 'DMSans_600SemiBold',
  },
  disclaimerLink: {
    color: theme.textDim,
    textDecorationLine: 'underline',
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
