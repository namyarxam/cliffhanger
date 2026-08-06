import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useThemeControl } from '@/src/providers/ThemeProvider';
import { THEME_LABELS, THEME_DESCRIPTIONS, type Theme, type ThemeName } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { supabase } from '@/src/lib/supabase';
import { registerForPushNotifications } from '@/src/lib/notifications';
import { silentCatch } from '@/src/lib/errorLog';
import Constants from 'expo-constants';

const PRIVACY_URL = 'https://cliffhangerapp.com/privacy';

const THEME_ORDER: ThemeName[] = ['navy', 'smoke', 'plum', 'paper'];

export default function SettingsScreen() {
  const { theme, themeName, setThemeName } = useThemeControl();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { user, refreshProfile, signOut, resetCoachmarks } = useAuth();
  const [pushFriendRequests, setPushFriendRequests] = useState(true);
  const [showPosters, setShowPosters] = useState(true);
  const [hideRatings, setHideRatings] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('profiles')
      .select('push_friend_requests, show_posters_in_list, hide_ratings')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) { silentCatch('settings:loadProfile')(error); return; }
        if (data) {
                    setPushFriendRequests(data.push_friend_requests ?? true);
          setShowPosters(data.show_posters_in_list);
          setHideRatings(data.hide_ratings);
        }
      });
  }, [user?.id]);

  const updateProfile = useCallback(async (field: string, value: boolean | string) => {
    if (!user?.id) return;
    const { error } = await supabase
      .from('profiles')
      .update({ [field]: value })
      .eq('id', user.id);

    if (error) return false;
    await refreshProfile();
    return true;
  }, [user?.id, refreshProfile]);

  const handleToggleFriendRequests = useCallback(async () => {
    if (!user?.id) return;
    const newValue = !pushFriendRequests;
    if (newValue) {
      const token = await registerForPushNotifications(user.id);
      if (!token) {
        Alert.alert(
          'Notifications Disabled',
          'Please enable notifications for Cliffhanger in your device settings.',
        );
        return;
      }
    }
    setPushFriendRequests(newValue);
    const ok = await updateProfile('push_friend_requests', newValue);
    if (!ok) setPushFriendRequests(!newValue);
  }, [user?.id, pushFriendRequests, updateProfile]);

  const handleTogglePosters = useCallback(async () => {
    const newValue = !showPosters;
    setShowPosters(newValue);
    const ok = await updateProfile('show_posters_in_list', newValue);
    if (!ok) setShowPosters(!newValue);
  }, [showPosters, updateProfile]);

  const handleToggleHideRatings = useCallback(async () => {
    const newValue = !hideRatings;
    setHideRatings(newValue);
    const ok = await updateProfile('hide_ratings', newValue);
    if (!ok) setHideRatings(!newValue);
  }, [hideRatings, updateProfile]);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account, watchlists, ratings, messages, and friendships. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you absolutely sure?',
              'Your account and all associated data will be permanently deleted.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete Forever',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      const { data, error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
                      if (error) {
                        const ctx = error instanceof Error ? await (error as unknown as { context?: Response }).context?.text?.() : undefined;
                        throw new Error(`${error.message}${ctx ? ` — ${ctx}` : ''}`);
                      }
                      if (data && !data.ok) throw new Error(data.error || 'Unknown error');
                      await signOut();
                    } catch (e) {
                      silentCatch('settings:deleteAccount')(e);
                      const msg = e instanceof Error ? e.message : String(e);
                      Alert.alert('Delete Failed', msg);
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, [signOut]);


  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      {/* Notifications section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        {/* Premiere alerts are automatic — no toggle. The one push about
            airings is "your show is coming back", sent the week a new season
            of a tracked show premieres. The row states the behavior so the
            section doesn't imply pushes are off. Escape hatch is the OS
            notification settings, like any other app. */}
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Season Premieres</Text>
            <Text style={styles.settingHint}>
              When a show you track comes back, we'll notify you the week of
              the premiere. Automatic for all tracked shows.
            </Text>
          </View>
        </View>

        <View style={styles.settingGap} />

        <Pressable style={styles.settingRow} onPress={handleToggleFriendRequests}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Friend Requests</Text>
            <Text style={styles.settingHint}>
              Get notified when someone adds you as a friend or accepts your request.
            </Text>
          </View>
          <View style={[styles.toggleTrack, pushFriendRequests && styles.toggleTrackOn]}>
            <View style={[styles.toggleThumb, pushFriendRequests && styles.toggleThumbOn]} />
          </View>
        </Pressable>
      </View>

      {/* Display section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Display</Text>

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

      {/* Theme section */}
      <View style={styles.section}>
        <View style={styles.themeSectionHeader}>
          <Text style={[styles.sectionTitle, styles.themeSectionTitle]}>Theme</Text>
          <View style={styles.betaBadge}>
            <Text style={styles.betaBadgeText}>BETA</Text>
          </View>
        </View>
        {THEME_ORDER.map((name, idx) => {
          const active = themeName === name;
          return (
            <Pressable
              key={name}
              style={({ pressed }) => [
                styles.themeRow,
                idx === 0 && styles.themeRowFirst,
                idx === THEME_ORDER.length - 1 && styles.themeRowLast,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => {
                setThemeName(name);
                updateProfile('theme', name);
              }}
            >
              <View style={styles.themeInfo}>
                <Text style={styles.themeLabel}>{THEME_LABELS[name]}</Text>
                <Text style={styles.themeDescription}>{THEME_DESCRIPTIONS[name]}</Text>
              </View>
              {active && <Text style={styles.themeActiveCheck}>✓</Text>}
            </Pressable>
          );
        })}
      </View>

      {/* Social section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Social</Text>
        <Pressable style={styles.settingRow} onPress={handleToggleHideRatings}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Hide My Ratings</Text>
            <Text style={styles.settingHint}>
              Friends won't see your ratings on shows
            </Text>
          </View>
          <View style={[styles.toggleTrack, hideRatings && styles.toggleTrackOn]}>
            <View style={[styles.toggleThumb, hideRatings && styles.toggleThumbOn]} />
          </View>
        </Pressable>

        <View style={styles.settingGap} />

        <Pressable
          style={({ pressed }) => [styles.settingRow, pressed && { opacity: 0.7 }]}
          onPress={() => router.push('/(tabs)/blocked')}
        >
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Blocked Users</Text>
            <Text style={styles.settingHint}>Manage users you've blocked</Text>
          </View>
          <Text style={styles.settingChevron}>▸</Text>
        </Pressable>
      </View>

      {/* Account section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Email</Text>
          <Text style={styles.aboutValue}>{user?.email}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.deleteButton, pressed && { opacity: 0.7 }]}
          onPress={handleDeleteAccount}
        >
          <Text style={styles.deleteButtonText}>Delete Account</Text>
        </Pressable>
      </View>

      {/* Tutorial reset — useful for re-experiencing coachmarks. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tutorial</Text>
        <Pressable
          style={({ pressed }) => [styles.resetCoachmarksBtn, pressed && { opacity: 0.7 }]}
          onPress={async () => { await resetCoachmarks(); Alert.alert('Tutorial reset', 'Coachmarks will reappear as you use the app.'); }}
        >
          <Text style={styles.resetCoachmarksText}>Replay tips</Text>
        </Pressable>
      </View>

      {/* About section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Version</Text>
          {/* Read from app.json rather than typed here — the hardcoded string
              said 1.0.0 for two releases after the app shipped 1.0.2. */}
          <Text style={styles.aboutValue}>{Constants.expoConfig?.version ?? '—'}</Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Data</Text>
          <Text style={styles.aboutValue}>Powered by TVMaze</Text>
        </View>
        {/* Required by TMDB's terms of use: recap artwork and stills are served
            from their CDN, and the wording of the disclaimer is theirs, not ours. */}
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Recap art</Text>
          <Text style={styles.aboutValue}>Images by TMDB</Text>
        </View>
        <View style={styles.aboutAttribution}>
          <Text style={styles.aboutAttributionText}>
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.aboutRow, pressed && { opacity: 0.7 }]}
          onPress={() => Linking.openURL(PRIVACY_URL)}
        >
          <Text style={styles.aboutLabel}>Privacy Policy</Text>
          <Text style={styles.aboutLink}>Open ▸</Text>
        </Pressable>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  aboutAttribution: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  aboutAttributionText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color: theme.textDim,
  },
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  scrollContent: {
    paddingBottom: 40,
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
  settingLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingLabel: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  betaBadge: {
    backgroundColor: 'rgba(255,107,53,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  betaBadgeText: {
    fontSize: 9,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
    letterSpacing: 0.8,
  },
  settingChevron: {
    fontSize: 18,
    color: theme.textFaint,
  },
  themeSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  themeSectionTitle: {
    marginBottom: 0,
  },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.bgCard,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: theme.border,
    borderTopWidth: 0,
  },
  themeRowFirst: {
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderTopWidth: 1,
  },
  themeRowLast: {
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
  },
  themeInfo: {
    flex: 1,
    marginRight: 12,
  },
  themeLabel: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  themeDescription: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    marginTop: 2,
  },
  themeActiveCheck: {
    fontSize: 16,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
  },
  settingHint: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    marginTop: 4,
    lineHeight: 18,
  },
  settingNote: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    marginTop: 10,
    lineHeight: 18,
    paddingHorizontal: 4,
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
  aboutLink: {
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
    color: theme.accent,
  },
  resetCoachmarksBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
  },
  resetCoachmarksText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  deleteButton: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
    alignItems: 'center',
  },
  deleteButtonText: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: '#ef4444',
  },
});
