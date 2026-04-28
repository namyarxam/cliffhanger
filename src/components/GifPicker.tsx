import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';

const GIPHY_API_KEY = process.env.EXPO_PUBLIC_GIPHY_API_KEY ?? '';
const COLUMN_COUNT = 2;
const SCREEN_WIDTH = Dimensions.get('window').width;
const GIF_SIZE = (SCREEN_WIDTH - 48) / COLUMN_COUNT;

interface Props {
  onSelect: (gifUrl: string) => void;
}

interface GiphyGif {
  id: string;
  images: {
    fixed_width: {
      url: string;
      width: string;
      height: string;
    };
  };
}

export default function GifPicker({ onSelect }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchGifs = useCallback(async (searchQuery: string) => {
    setLoading(true);
    try {
      const endpoint = searchQuery.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(searchQuery.trim())}&limit=30&rating=pg-13`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=30&rating=pg-13`;

      const res = await fetch(endpoint);
      const json = await res.json();
      setGifs(json.data ?? []);
    } catch {
      setGifs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGifs('');
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchGifs]);

  const handleSearch = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchGifs(text);
    }, 400);
  }, [fetchGifs]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search GIFs..."
        placeholderTextColor={theme.textFaint}
        value={query}
        onChangeText={handleSearch}
        autoCorrect={false}
        returnKeyType="search"
      />

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      ) : gifs.length === 0 ? (
        <View style={styles.loadingWrap}>
          <Text style={styles.emptyText}>No GIFs found</Text>
        </View>
      ) : (
        <FlatList
          data={gifs}
          keyExtractor={item => item.id}
          numColumns={COLUMN_COUNT}
          columnWrapperStyle={styles.row}
          renderItem={({ item }) => {
            const fw = item.images.fixed_width;
            const aspectRatio = parseInt(fw.width, 10) / parseInt(fw.height, 10);
            return (
              <Pressable
                style={({ pressed }) => [styles.gifWrap, pressed && { opacity: 0.7 }]}
                onPress={() => onSelect(fw.url)}
              >
                <Image
                  source={{ uri: fw.url }}
                  style={[styles.gif, { aspectRatio }]}
                  contentFit="cover"
                  autoplay
                />
              </Pressable>
            );
          }}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        />
      )}

      <View style={styles.attribution}>
        <Text style={styles.attributionText}>Powered by GIPHY</Text>
      </View>
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
  },
  searchInput: {
    backgroundColor: theme.bgCard,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
    borderWidth: 1,
    borderColor: theme.border,
    marginHorizontal: 16,
    marginVertical: 12,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  row: {
    gap: 8,
    marginBottom: 8,
  },
  gifWrap: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  gif: {
    width: '100%',
    borderRadius: 8,
  },
  attribution: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  attributionText: {
    fontSize: 10,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },
});
