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
  const { user, refreshProfile } = useAuth();
  const [pushNewEpisodes, setPushNewEpisodes] = useState(false);
  const [showTop4, setShowTop4] = useState(true);
  const [showPosters, setShowPosters] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('profiles')
      .select('push_new_episodes, show_top4_in_list, show_posters_in_list')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setPushNewEpisodes(data.push_new_episodes);
          setShowTop4(data.show_top4_in_list);
          setShowPosters(data.show_posters_in_list);
        }
      });
  }, [user?.id]);

  const updateProfile = useCallback(async (field: string, value: boolean) => {
    if (!user?.id) return;
    const { error } = await supabase
      .from('profiles')
      .update({ [field]: value })
      .eq('id', user.id);

    if (error) return false;
    await refreshProfile();
    return true;
  }, [user?.id, refreshProfile]);

  const handleTogglePush = useCallback(async () => {
    if (!user?.id) return;
    const newValue = !pushNewEpisodes;

    if (newValue) {
      const token = await registerForPushNotifications(user.id);
      if (!token) {
        Alert.alert(
          'Notifications Disabled',
          'Please enable notifications for Cliffhanger in your device settings.',
        );
        return;
      }
    } else {
      await unregisterPushNotifications(user.id);
    }

    setPushNewEpisodes(newValue);
    const ok = await updateProfile('push_new_episodes', newValue);
    if (!ok) setPushNewEpisodes(!newValue);
  }, [user?.id, pushNewEpisodes, updateProfile]);

  const handleToggleTop4 = useCallback(async () => {
    const newValue = !showTop4;
    setShowTop4(newValue);
    const ok = await updateProfile('show_top4_in_list', newValue);
    if (!ok) setShowTop4(!newValue);
  }, [showTop4, updateProfile]);

  const handleTogglePosters = useCallback(async () => {
    const newValue = !showPosters;
    setShowPosters(newValue);
    const ok = await updateProfile('show_posters_in_list', newValue);
    if (!ok) setShowPosters(!newValue);
  }, [showPosters, updateProfile]);

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

      {/* Display section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Display</Text>

        <Pressable style={styles.settingRow} onPress={handleToggleTop4}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Show Favorites in My Shows</Text>
            <Text style={styles.settingHint}>
              Display your Top 4 at the top of your show list
            </Text>
          </View>
          <View style={[styles.toggleTrack, showTop4 && styles.toggleTrackOn]}>
            <View style={[styles.toggleThumb, showTop4 && styles.toggleThumbOn]} />
          </View>
        </Pressable>

        <View style={styles.settingGap} />

        <Pressable style={styles.settingRow} onPress={handleTogglePosters}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Show Posters</Text>
            <Text style={styles.settingHint}>
              Display show poster images in your lists
            </Text>
          </View>
          <View style={[styles.toggleTrack, showPosters && styles.toggleTrackOn]}>
            <View style={[styles.toggleThumb, showPosters && styles.toggleThumbOn]} />
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
  settingGap: {
    height: 10,
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
