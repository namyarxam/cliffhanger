import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/providers/ThemeProvider';
import { useAuth } from '@/src/providers/AuthProvider';
import { searchShows, fetchShow } from '@/src/lib/data';
import { addShow, getLastAiredEpisode, countAiredEpisodes } from '@/src/lib/watchlist';
import { silentCatch } from '@/src/lib/errorLog';
import ShowCard from '@/src/components/ShowCard';
import type { Theme } from '@/src/lib/theme';
import type { ShowSummary } from '@/src/lib/types';

export default function FirstShowScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { session, markOnboarded } = useAuth();
  const userId = session?.user?.id;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ShowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ id: string; title: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Auto-focus the field on mount so the keyboard is up immediately — the
  // whole point of this screen is "type and pick", every extra tap is friction.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 320);
    return () => clearTimeout(t);
  }, []);

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchShows(text);
        setResults(data);
      } catch (e: any) {
        setError(e.message ?? 'Search failed');
      } finally {
        setLoading(false);
      }
    }, 450);
  }, []);

  const handlePick = useCallback(async (summary: ShowSummary) => {
    if (!userId || adding) return;
    Haptics.selectionAsync().catch(() => {});
    setAdding({ id: summary.id, title: summary.title });
    try {
      const full = await fetchShow(summary.id);
      const lastAired = getLastAiredEpisode(full.seasons);
      await addShow(userId, full.id, 'currently_watching', full.title, full.image, full.network, {
        showStatus: full.status,
        nextEpisodeAirdate: full.nextEpisode?.airdate ?? null,
        nextEpisodeSeason: full.nextEpisode?.season ?? null,
        nextEpisodeEpisode: full.nextEpisode?.number ?? null,
        lastAiredSeason: lastAired?.season ?? null,
        lastAiredEpisode: lastAired?.episode ?? null,
        lastAiredAirdate: lastAired?.airdate ?? null,
        totalAiredEpisodes: countAiredEpisodes(full.seasons),
      });
      await markOnboarded();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace('/(tabs)');
    } catch (e) {
      silentCatch('onboarding:firstShow')(e);
      setAdding(null);
      setError('Could not add that show. Try another?');
    }
  }, [userId, adding, markOnboarded, router]);

  const handleSkip = async () => {
    if (adding) return;
    await markOnboarded();
    router.replace('/(tabs)');
  };

  const renderItem = useCallback(({ item }: { item: ShowSummary }) => (
    <ShowCard show={item} onPress={() => handlePick(item)} />
  ), [handlePick]);

  const showResults = !loading && results.length > 0;
  const showEmpty = !loading && query.trim().length >= 2 && results.length === 0 && !error;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Pressable onPress={handleSkip} hitSlop={10} style={styles.skipTop}>
          <Text style={styles.skipTopText}>Skip</Text>
        </Pressable>
      </View>

      <Animated.View entering={FadeInDown.duration(440)} style={styles.intro}>
        <Text style={styles.title}>What are you{'\n'}watching right now?</Text>
        <Text style={styles.subtitle}>
          Pick one show to start. You can add as many more as you want from the Explore tab.
        </Text>
      </Animated.View>

      <Animated.View entering={FadeIn.delay(160).duration(360)} style={styles.searchWrap}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Search shows…"
          placeholderTextColor={theme.textFaint}
          value={query}
          onChangeText={handleSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          editable={!adding}
        />
      </Animated.View>

      <View style={styles.resultsArea}>
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} size="small" />
          </View>
        )}
        {error && !loading && (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        {showResults && (
          <FlatList
            data={results}
            renderItem={renderItem}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.list}
          />
        )}
        {showEmpty && (
          <View style={styles.center}>
            <Text style={styles.dim}>No shows match "{query}"</Text>
          </View>
        )}
        {!loading && !error && query.trim().length < 2 && (
          <View style={styles.hintWrap}>
            <Text style={styles.dim}>Try "severance", "house", or your favorite show.</Text>
          </View>
        )}
      </View>

      {adding && (
        <Animated.View entering={FadeIn.duration(180)} style={styles.addingOverlay}>
          <ActivityIndicator color={theme.accent} size="small" />
          <Text style={styles.addingText}>
            Adding <Text style={styles.addingTitle}>{adding.title}</Text>…
          </Text>
        </Animated.View>
      )}
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  back: { padding: 6 },
  backText: { color: theme.textDim, fontSize: 22, fontFamily: 'DMSans_500Medium' },
  skipTop: { padding: 6 },
  skipTopText: { color: theme.textDim, fontSize: 14, fontFamily: 'DMSans_500Medium' },
  intro: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 20,
  },
  title: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 26,
    lineHeight: 32,
    color: theme.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: theme.textDim,
    marginTop: 10,
  },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 12 },
  input: {
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
  },
  resultsArea: { flex: 1 },
  list: { paddingBottom: 24 },
  center: { padding: 32, alignItems: 'center' },
  hintWrap: { paddingHorizontal: 32, paddingTop: 20, alignItems: 'center' },
  dim: { color: theme.textFaint, fontFamily: 'DMSans_400Regular', fontSize: 13, textAlign: 'center' },
  errorText: { color: '#f87171', fontFamily: 'DMSans_600SemiBold', fontSize: 14, textAlign: 'center' },
  addingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  addingText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: theme.text,
  },
  addingTitle: {
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
});
