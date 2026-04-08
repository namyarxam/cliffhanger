import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useAuth } from '@/src/providers/AuthProvider';
import { theme } from '@/src/lib/theme';

export default function ProfileScreen() {
  const { profile, user, signOut } = useAuth();

  return (
    <View style={styles.container}>
      {/* Avatar placeholder */}
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {(profile?.display_name || profile?.username || '?')[0].toUpperCase()}
        </Text>
      </View>

      <Text style={styles.displayName}>
        {profile?.display_name || 'Anonymous'}
      </Text>
      <Text style={styles.username}>
        @{profile?.username || 'unknown'}
      </Text>
      <Text style={styles.email}>{user?.email}</Text>

      {/* Future: friends list, stats, settings will go here */}

      <Pressable style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 32,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.bgCard,
    borderWidth: 2,
    borderColor: theme.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 32,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
  },
  displayName: {
    fontSize: 22,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 4,
  },
  username: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
    marginBottom: 4,
  },
  email: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    marginBottom: 40,
  },
  signOutButton: {
    marginTop: 'auto',
    marginBottom: 40,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.3)',
  },
  signOutText: {
    color: '#f87171',
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
  },
});
