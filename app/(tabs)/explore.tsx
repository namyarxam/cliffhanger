import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/providers/ThemeProvider';
import { useCoachmark } from '@/src/tutorial/useCoachmark';
import type { Theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { searchShows } from '@/src/lib/data';
import {
  getPopularWithFriends,
  getAiringThisWeek,
  getTopRated,
  muteShow,
  POPULAR_SHOWS_LIMIT_DEFAULT,
} from '@/src/lib/watchlist';
import type { PopularShow, FeaturedShow } from '@/src/lib/watchlist';
import ShowCard from '@/src/components/ShowCard';
import FeaturedCarousel from '@/src/components/FeaturedCarousel';
import type { FeaturedItem } from '@/src/components/FeaturedCarousel';
import type { ShowSummary } from '@/src/lib/types';
import { qk } from '@/src/lib/queryKeys';
import { silentCatch } from '@/src/lib/errorLog';

// Top Rated reveals the 90-show pool one page at a time as the user
// scrolls. Page size matches the original display count so the first
// page looks identical to before the extend behavior was added.
const TOP_RATED_POOL_SIZE = 90;
const TOP_RATED_PAGE_SIZE = 15;

export default function SearchScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();
  const [results, setResults] = useState<ShowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset all carousels (scroll position + Top Rated's reveal page count)
  // when the tab loses focus. Doing it on focus-OUT instead of focus-IN
  // means the next time the user lands on this screen, state is already
  // fresh — no flash of "you were 5 pages in to Top Rated" before the
  // reset effect fires. Tabs stay mounted across navigation, so without
  // this the user returns to wherever they left off.
  const [carouselResetSignal, setCarouselResetSignal] = useState(0);
  const [topRatedDisplayCount, setTopRatedDisplayCount] = useState(TOP_RATED_PAGE_SIZE);
  useFocusEffect(useCallback(() => {
    return () => {
      setCarouselResetSignal(s => s + 1);
      setTopRatedDisplayCount(TOP_RATED_PAGE_SIZE);
    };
  }, []));

  // ─── Three explore queries ────────────────────────────────────────────────
  // Popular with Friends — derived live from the user's friends' watchlists.
  // Airing This Week — cron-refreshed featured table, scoped by Scripted +
  // non-broadcast + non-procedural filters.
  // Top Rated — manually curated 90-show list from IMDB Top 250.
  const popularQ = useQuery({
    queryKey: qk.popular(userId, POPULAR_SHOWS_LIMIT_DEFAULT),
    queryFn: () => getPopularWithFriends(userId!, POPULAR_SHOWS_LIMIT_DEFAULT),
    enabled: !!userId,
  });
  const airingQ = useQuery({
    queryKey: qk.airingThisWeek(userId),
    queryFn: () => getAiringThisWeek(userId),
    enabled: !!userId,
  });
  // Fetch the full pool once and slice client-side. With extend mode we
  // need access to all 90 entries up front so onEndReached can hand the
  // user the next page without a network round-trip.
  const topRatedQ = useQuery({
    queryKey: qk.topRated(userId),
    queryFn: () => getTopRated(userId, TOP_RATED_POOL_SIZE),
    enabled: !!userId,
  });

  useEffect(() => {
    if (popularQ.error) silentCatch('explore:popular')(popularQ.error);
  }, [popularQ.error]);
  useEffect(() => {
    if (airingQ.error) silentCatch('explore:airing')(airingQ.error);
  }, [airingQ.error]);
  useEffect(() => {
    if (topRatedQ.error) silentCatch('explore:topRated')(topRatedQ.error);
  }, [topRatedQ.error]);

  // Popular shape differs slightly (PopularShow has friend_count etc), but
  // the carousel only needs show_id / title / image. Map down for parity
  // with the other two carousels.
  const popularItems: FeaturedItem[] = useMemo(
    () => (popularQ.data ?? []).map((s: PopularShow) => ({
      show_id: s.show_id,
      show_title: s.show_title,
      show_image: s.show_image,
    })),
    [popularQ.data],
  );
  const airingItems: FeaturedItem[] = useMemo(
    () => (airingQ.data ?? []).map((s: FeaturedShow) => ({
      show_id: s.show_id,
      show_title: s.show_title,
      show_image: s.show_image,
    })),
    [airingQ.data],
  );
  const topRatedPool: FeaturedItem[] = useMemo(
    () => (topRatedQ.data ?? []).map((s: FeaturedShow) => ({
      show_id: s.show_id,
      show_title: s.show_title,
      show_image: s.show_image,
    })),
    [topRatedQ.data],
  );
  const topRatedItems: FeaturedItem[] = useMemo(
    () => topRatedPool.slice(0, topRatedDisplayCount),
    [topRatedPool, topRatedDisplayCount],
  );

  const handleTopRatedEndReached = useCallback(() => {
    setTopRatedDisplayCount(c => Math.min(c + TOP_RATED_PAGE_SIZE, topRatedPool.length));
  }, [topRatedPool.length]);

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    setError(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (text.trim().length < 3) {
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
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }, 600);
  }, []);

  const handlePress = useCallback((id: string) => {
    router.push(`/show/${id}?from=/explore`);
  }, [router]);

  const handleCancel = useCallback(() => {
    Keyboard.dismiss();
    setQuery('');
    setResults([]);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Optimistic-mute: write through the carousel cache for instant UI
  // response (poster animates out → list rerenders with one fewer card),
  // then commit to Supabase. On failure, invalidate so the next read
  // re-pulls from server truth.
  const handleMute = useCallback(async (showId: string) => {
    if (!userId) return;
    const item =
      popularItems.find(i => i.show_id === showId) ||
      airingItems.find(i => i.show_id === showId) ||
      topRatedItems.find(i => i.show_id === showId);
    if (!item) return;

    queryClient.setQueryData<PopularShow[]>(
      qk.popular(userId, POPULAR_SHOWS_LIMIT_DEFAULT),
      prev => (prev ?? []).filter(s => s.show_id !== showId),
    );
    queryClient.setQueryData<FeaturedShow[]>(
      qk.airingThisWeek(userId),
      prev => (prev ?? []).filter(s => s.show_id !== showId),
    );
    queryClient.setQueryData<FeaturedShow[]>(
      qk.topRated(userId),
      prev => (prev ?? []).filter(s => s.show_id !== showId),
    );

    try {
      await muteShow(userId, showId, item.show_title ?? 'Untitled', item.show_image);
      // Refresh user_shows so My Shows / Profile reflect the new muted row,
      // and invalidate the explore caches so the next-ranked entry can
      // backfill the freed slot (Top Rated has 90 in the pool, displays 15).
      queryClient.invalidateQueries({ queryKey: qk.userShows.all(userId) });
      queryClient.invalidateQueries({ queryKey: qk.popular(userId) });
      queryClient.invalidateQueries({ queryKey: qk.airingThisWeek(userId) });
      queryClient.invalidateQueries({ queryKey: qk.topRated(userId) });
    } catch (e) {
      silentCatch('explore:mute')(e);
      queryClient.invalidateQueries({ queryKey: qk.popular(userId) });
      queryClient.invalidateQueries({ queryKey: qk.airingThisWeek(userId) });
      queryClient.invalidateQueries({ queryKey: qk.topRated(userId) });
    }
  }, [userId, popularItems, airingItems, topRatedItems, queryClient]);

  const renderItem = useCallback(({ item }: { item: ShowSummary }) => (
    <ShowCard show={item} onPress={handlePress} />
  ), [handlePress]);

  // Coach the user on long-press-to-mute. We attach the anchor to the first
  // poster of whichever carousel renders first AND has data — so the tooltip
  // points at something visible. Trigger fires only when the user is on
  // Explore (carousels visible) and there's at least one card to long-press.
  const firstCardRef = useRef<View>(null);
  const firstNonEmptyCarousel: 'popular' | 'airing' | 'topRated' | null =
    popularItems.length > 0 ? 'popular'
    : airingItems.length > 0 ? 'airing'
    : topRatedItems.length > 0 ? 'topRated'
    : null;
  const showCarousels = !query.trim() && !loading;
  useCoachmark({
    id: 'long_press_mute',
    when: showCarousels && firstNonEmptyCarousel !== null,
    ref: firstCardRef,
    gesture: 'longpress',
    title: 'Hide shows you don\'t care about',
    body: 'Press and hold any poster to mute it from your Explore feed.',
    delay: 700,
  });

  const showSearching = loading;
  const showError = !!error;
  const showResults = !loading && !error && results.length > 0;
  const showNoResults = !loading && !error && query.trim().length >= 3 && results.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <TextInput
          style={[styles.searchInput, (isFocused || query.length > 0) && styles.searchInputActive]}
          placeholder="Search TV shows..."
          placeholderTextColor={theme.textFaint}
          value={query}
          onChangeText={handleSearch}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {(isFocused || query.length > 0) && (
          <Pressable onPress={handleCancel} hitSlop={8} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        )}
      </View>

      {showCarousels && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.exploreScroll}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {/* Each carousel renders its skeleton state on initial load and
              hides the row entirely if a settled fetch returned no rows
              (e.g. user has no friends yet → no Popular). */}
          {(popularQ.isLoading || popularItems.length > 0) && (
            <View style={styles.carouselSection}>
              <Text style={styles.carouselTitle}>Popular with Friends</Text>
              <FeaturedCarousel items={popularItems} loading={popularQ.isLoading} onPress={handlePress} onMute={handleMute} resetSignal={carouselResetSignal} firstItemRef={firstNonEmptyCarousel === 'popular' ? firstCardRef : undefined} />
            </View>
          )}
          {(airingQ.isLoading || airingItems.length > 0) && (
            <View style={styles.carouselSection}>
              <Text style={styles.carouselTitle}>Airing This Week</Text>
              <FeaturedCarousel items={airingItems} loading={airingQ.isLoading} onPress={handlePress} onMute={handleMute} resetSignal={carouselResetSignal} firstItemRef={firstNonEmptyCarousel === 'airing' ? firstCardRef : undefined} />
            </View>
          )}
          {(topRatedQ.isLoading || topRatedItems.length > 0) && (
            <View style={styles.carouselSection}>
              <Text style={styles.carouselTitle}>Top Rated</Text>
              <FeaturedCarousel items={topRatedItems} loading={topRatedQ.isLoading} onPress={handlePress} onMute={handleMute} resetSignal={carouselResetSignal} mode="extend" onEndReached={handleTopRatedEndReached} firstItemRef={firstNonEmptyCarousel === 'topRated' ? firstCardRef : undefined} />
            </View>
          )}
          {popularItems.length === 0 && airingItems.length === 0 && topRatedItems.length === 0 &&
           !popularQ.isLoading && !airingQ.isLoading && !topRatedQ.isLoading && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Search for a TV show to get started</Text>
            </View>
          )}
        </ScrollView>
      )}

      {showSearching && (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="small" />
        </View>
      )}

      {showError && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {showResults && (
        <FlatList
          data={results}
          keyboardShouldPersistTaps="handled"
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          keyboardDismissMode="on-drag"
        />
      )}

      {showNoResults && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No shows match "{query}"</Text>
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  center: {
    padding: 32,
    alignItems: 'center',
  },
  errorText: {
    color: '#f87171',
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
    textAlign: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    backgroundColor: theme.bgCard,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
  },
  searchInputActive: {
    borderColor: theme.accent,
  },
  cancelButton: {
    paddingVertical: 6,
  },
  cancelText: {
    color: theme.accent,
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 15,
  },
  list: {
    paddingBottom: 20,
  },
  empty: {
    padding: 48,
    alignItems: 'center',
  },
  emptyText: {
    color: theme.textFaint,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
  },
  exploreScroll: {
    paddingTop: 24,
    paddingBottom: 20,
  },
  carouselSection: {
    marginBottom: 18,
  },
  carouselTitle: {
    fontSize: 15,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
});
