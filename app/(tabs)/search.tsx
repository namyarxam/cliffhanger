import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '@/src/lib/theme';
import { fetchRankings } from '@/src/lib/data';
import ShowCard from '@/src/components/ShowCard';
import type { ShowSummary } from '@/src/lib/types';

export default function SearchScreen() {
  const router = useRouter();
  const [shows, setShows] = useState<ShowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchRankings()
      .then(setShows)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Simple case-insensitive title search
  const results = useMemo(() => {
    if (!query.trim()) return shows.slice(0, 100); // show top 100 by default
    const q = query.toLowerCase();
    return shows.filter(s => s.title.toLowerCase().includes(q)).slice(0, 50);
  }, [shows, query]);

  const handlePress = useCallback((id: string) => {
    router.push(`/show/${id}`);
  }, [router]);

  const renderItem = useCallback(({ item, index }: { item: ShowSummary; index: number }) => (
    <ShowCard
      show={item}
      rank={!query.trim() ? index + 1 : undefined}
      onPress={handlePress}
    />
  ), [query, handlePress]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
        <Text style={styles.loadingText}>Loading shows...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Failed to load: {error}</Text>
        <Text style={styles.errorHint}>
          Make sure the web app dev server is running (npm run dev in cliffhanger/)
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search TV shows..."
          placeholderTextColor={theme.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={results}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No shows match "{query}"</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  center: {
    flex: 1,
    backgroundColor: theme.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    color: theme.textDim,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
  },
  errorText: {
    color: '#f87171',
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
    textAlign: 'center',
  },
  errorHint: {
    color: theme.textFaint,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
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
});
