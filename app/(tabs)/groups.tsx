import { View, Text, StyleSheet } from 'react-native';
import { theme } from '@/src/lib/theme';

// Phase 4 will replace this with the groups list
export default function GroupsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>👥</Text>
      <Text style={styles.title}>Groups</Text>
      <Text style={styles.subtitle}>
        Watch shows together with friends.{'\n'}
        Create a group to get started.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    textAlign: 'center',
    lineHeight: 22,
  },
});
