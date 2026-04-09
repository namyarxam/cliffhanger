import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import { theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { supabase } from '@/src/lib/supabase';
import { registerForPushNotifications, unregisterPushNotifications } from '@/src/lib/notifications';

export default function SettingsScreen() {
  const { user } = useAuth();
  const [pushNewEpisodes, setPushNewEpisodes] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('profiles')
      .select('push_new_episodes')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) setPushNewEpisodes(data.push_new_episodes);
      });
  }, [user?.id]);

  const handleTogglePush = useCallback(async () => {
    if (!user?.id) return;
    const newValue = !pushNewEpisodes;

    if (newValue) {
      // Turning on: request permission and register token
      const token = await registerForPushNotifications(user.id);
      if (!token) {
        Alert.alert(
          'Notifications Disabled',
          'Please enable notifications for Cliffhanger in your device settings.',
        );
        return;
      }
    } else {
      // Turning off: remove push token
      await unregisterPushNotifications(user.id);
    }

    setPushNewEpisodes(newValue);
    const { error } = await supabase
      .from('profiles')
      .update({ push_new_episodes: newValue })
      .eq('id', user.id);

    if (error) {
      setPushNewEpisodes(!newValue);
      Alert.alert('Error', 'Failed to update setting');
    }
  }, [user?.id, pushNewEpisodes]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      {/* Notifications section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>

        <Pressable style={styles.settingRow} onPress={handleTogglePush}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>New Episode Alerts</Text>
            <Text style={styles.settingHint}>
              Get notified when new episodes air for shows you're watching
            </Text>
          </View>
          <View style={[styles.toggleTrack, pushNewEpisodes && styles.toggleTrackOn]}>
            <View style={[styles.toggleThumb, pushNewEpisodes && styles.toggleThumbOn]} />
          </View>
        </Pressable>
      </View>

      {/* About section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>

        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Version</Text>
          <Text style={styles.aboutValue}>1.0.0</Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Data</Text>
          <Text style={styles.aboutValue}>Powered by TVMaze</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'DMSans_700Bold',
    color: theme.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.bgCard,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  settingInfo: {
    flex: 1,
    marginRight: 12,
  },
  settingLabel: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  settingHint: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    marginTop: 4,
    lineHeight: 18,
  },
  toggleTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleTrackOn: {
    backgroundColor: theme.accent,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  aboutLabel: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: theme.text,
  },
  aboutValue: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
});
