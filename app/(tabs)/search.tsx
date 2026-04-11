import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { theme } from '@/src/lib/theme';
import { useAuth } from '@/src/providers/AuthProvider';
import { searchShows } from '@/src/lib/data';
import { getPopularWithFriends } from '@/src/lib/watchlist';
import type { PopularShow } from '@/src/lib/watchlist';
import ShowCard from '@/src/components/ShowCard';
import type { ShowSummary } from '@/src/lib/types';

export default function SearchScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;
  const [results, setResults] = useState<ShowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [popular, setPopular] = useState<PopularShow[]>([]);
  const [loadingPopular, setLoadingPopular] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;
    getPopularWithFriends(userId)
      .then(setPopular)
      .catch(() => {})
      .finally(() => setLoadingPopular(false));
  }, [userId]);

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
    router.push(`/show/${id}?from=/search`);
  }, [router]);

  const renderItem = useCallback(({ item }: { item: ShowSummary }) => (
    <ShowCard show={item} onPress={handlePress} />
  ), [handlePress]);

  const showPopular = !query.trim() && !loading && popular.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search TV shows..."
          placeholderTextColor={theme.textFaint}
          value={query}
          onChangeText={handleSearch}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      {showPopular && (
        <ScrollView style={styles.popularSection} contentContainerStyle={styles.popularContent}>
          <Text style={styles.popularTitle}>Popular with Friends</Text>
          {popular.map(show => (
            <Pressable
              key={show.show_id}
              style={({ pressed }) => [styles.popularRow, pressed && { opacity: 0.7 }]}
              onPress={() => handlePress(show.show_id)}
            >
              <View style={styles.popularPosterWrap}>
                {show.show_image ? (
                  <Image source={{ uri: show.show_image }} style={styles.popularPoster} contentFit="cover" />
                ) : (
                  <View style={[styles.popularPoster, styles.popularPosterPlaceholder]}>
                    <Text style={{ fontSize: 14 }}>📺</Text>
                  </View>
                )}
              </View>
              <View style={styles.popularInfo}>
                <Text style={styles.popularShowTitle} numberOfLines={1}>{show.show_title}</Text>
                <Text style={styles.popularFriends} numberOfLines={1}>
                  {show.friend_count === 1
                    ? show.friend_names[0]
                    : show.friend_count === 2
                      ? `${show.friend_names[0]} & ${show.friend_names[1]}`
                      : `${show.friend_names[0]} & ${show.friend_count - 1} others`}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {!query.trim() && !loading && !showPopular && !loadingPopular && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Search for a TV show to get started</Text>
        </View>
      )}

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="small" />
        </View>
      )}

      {error && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!loading && !error && results.length > 0 && (
        <FlatList
          data={results}
          keyboardShouldPersistTaps="handled"
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          keyboardDismissMode="on-drag"
        />
      )}

      {!loading && !error && query.trim() && results.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No shows match "{query}"</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  searchInput: {
    backgroundColor: theme.bgCard,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
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

  // Popular with Friends
  popularSection: {
    flex: 1,
  },
  popularContent: {
    paddingTop: 20,
    paddingBottom: 20,
  },
  popularTitle: {
    fontSize: 15,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  popularRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  popularPosterWrap: {
    width: 40,
    height: 56,
    borderRadius: 4,
    overflow: 'hidden',
  },
  popularPoster: {
    width: '100%',
    height: '100%',
  },
  popularPosterPlaceholder: {
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  popularInfo: {
    flex: 1,
    gap: 3,
  },
  popularShowTitle: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  popularFriends: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
});
