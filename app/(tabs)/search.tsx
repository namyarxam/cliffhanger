import { useState, useCallback, useRef } from 'react';
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
import { searchShows } from '@/src/lib/data';
import ShowCard from '@/src/components/ShowCard';
import type { ShowSummary } from '@/src/lib/types';

export default function SearchScreen() {
  const router = useRouter();
  const [results, setResults] = useState<ShowSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    router.push(`/show/${id}`);
  }, [router]);

  const renderItem = useCallback(({ item }: { item: ShowSummary }) => (
    <ShowCard show={item} onPress={handlePress} />
  ), [handlePress]);

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

      {!query.trim() && !loading && (
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
});
