import { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { fetchShow } from '@/src/lib/data';
import { getWatchedEpisodes, markUpToEpisode } from '@/src/lib/watchlist';
import { silentCatch } from '@/src/lib/errorLog';
import { getLocalToday } from '@/src/lib/utils';
import type { ShowFull } from '@/src/lib/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  userId: string | undefined;
  showId: string | null;
  showTitle: string;
  currentSeason: number;
  currentEpisode: number;
  onMarked: (season: number, episode: number) => void;
}

interface UnwatchedEpisode {
  season: number;
  episode: number;
  title: string;
  airdate: string | null;
  image: string | null;
  summary: string | null;
}

function formatShortDate(d: string): string {
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function EpisodeCatchUpSheet({
  visible, onClose, userId, showId, showTitle, currentSeason, currentEpisode, onMarked,
}: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [show, setShow] = useState<ShowFull | null>(null);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    if (!visible || !showId || !userId) return;
    setLoading(true);
    setShow(null);
    Promise.all([fetchShow(showId), getWatchedEpisodes(userId, showId)])
      .then(([s, w]) => { setShow(s); setWatched(w); })
      .catch(silentCatch('catchUpSheet:load'))
      .finally(() => setLoading(false));
  }, [visible, showId, userId]);

  const today = getLocalToday();
  const queue: UnwatchedEpisode[] = show
    ? show.seasons.flatMap(season =>
        season.episodes
          .filter(ep => {
            if (!ep.airdate || ep.airdate > today) return false;
            const isPastCurrent = season.number > currentSeason
              || (season.number === currentSeason && ep.number > currentEpisode);
            const isUnwatched = !watched.has(`S${season.number}E${ep.number}`);
            return isPastCurrent && isUnwatched;
          })
          .map(ep => ({
            season: season.number,
            episode: ep.number,
            title: ep.title,
            airdate: ep.airdate,
            image: ep.image,
            summary: ep.summary,
          }))
      )
    : [];

  const handleMarkUpTo = async (season: number, episode: number) => {
    if (!userId || !showId || !show || marking) return;
    setMarking(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // markUpToEpisode fills every aired episode from current → target into
      // episode_watches, no gaps. Different from markNextEpisode which only
      // upserts a single row.
      await markUpToEpisode(userId, showId, season, episode, show.seasons);
      onMarked(season, episode);
      onClose();
    } catch (e) {
      silentCatch('catchUpSheet:markUpTo')(e);
    } finally {
      setMarking(false);
    }
  };

  // Mark every aired-but-unwatched episode as watched in one tap. The last
  // entry in `queue` is always the most recently aired unwatched episode,
  // so handing it to markUpToEpisode catches the user up to "now."
  const handleMarkAll = () => {
    const last = queue[queue.length - 1];
    if (!last) return;
    handleMarkUpTo(last.season, last.episode);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerInfo}>
            <Text style={styles.title} numberOfLines={1}>{showTitle}</Text>
            {!loading && (
              <Text style={styles.subtitle}>
                {queue.length} episode{queue.length !== 1 ? 's' : ''} to catch up
              </Text>
            )}
          </View>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : queue.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>You're all caught up.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.hint}>Tap an episode to mark everything through it as watched.</Text>
            <FlatList
              data={queue}
              keyExtractor={item => `S${item.season}E${item.episode}`}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.55 }]}
                  onPress={() => handleMarkUpTo(item.season, item.episode)}
                  disabled={marking}
                >
                  <View style={styles.thumb}>
                    {item.image ? (
                      <Image source={{ uri: item.image }} style={styles.thumbImage} contentFit="cover" />
                    ) : (
                      <View style={[styles.thumbImage, styles.thumbPlaceholder]}>
                        <Text style={styles.thumbPlaceholderText}>📺</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.info}>
                    <Text style={styles.epMeta}>
                      S{item.season} · E{item.episode}
                      {item.airdate ? ` · ${formatShortDate(item.airdate)}` : ''}
                    </Text>
                    <Text style={styles.epTitle} numberOfLines={1}>{item.title}</Text>
                    {item.summary && (
                      <Text style={styles.epSummary} numberOfLines={2}>{item.summary}</Text>
                    )}
                  </View>
                </Pressable>
              )}
              ListFooterComponent={<View style={{ height: 24 }} />}
            />
          </>
        )}
      </View>
    </Modal>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 12,
  },
  headerInfo: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 18,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
  },
  close: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.accent,
  },
  markAllChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: theme.successBg,
    borderWidth: 1,
    borderColor: theme.successBorder,
  },
  markAllChipText: {
    color: theme.success,
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    letterSpacing: 0.1,
  },
  hint: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 12,
  },
  thumb: {
    width: 80,
    height: 56,
    borderRadius: 6,
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    backgroundColor: theme.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPlaceholderText: {
    fontSize: 22,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  epMeta: {
    fontSize: 11,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
    letterSpacing: 0.4,
  },
  epTitle: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  epSummary: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    lineHeight: 17,
  },
});
