import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Image } from 'expo-image';
import { theme } from '@/src/lib/theme';
import { fetchShow } from '@/src/lib/data';
import { getRatingColor, formatVotes, isLive } from '@/src/lib/utils';
import { SEASON_COLORS } from '@/src/lib/theme';
import RatingBadge from '@/src/components/RatingBadge';
import type { ShowFull, Season } from '@/src/lib/types';

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [show, setShow] = useState<ShowFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchShow(id)
      .then(data => {
        setShow(data);
        // Auto-expand the first season
        if (data.episodes?.length > 0) {
          setExpandedSeason(data.episodes[0].s);
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: '' }} />
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  if (error || !show) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Error' }} />
        <Text style={styles.errorText}>Failed to load show</Text>
        <Text style={styles.errorHint}>{error}</Text>
      </View>
    );
  }

  const live = isLive(show.lastAired);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{
        title: show.title,
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
      }} />

      {/* Hero: Poster + Info */}
      <View style={styles.hero}>
        {show.image ? (
          <Image source={{ uri: show.image }} style={styles.poster} contentFit="cover" transition={300} />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]}>
            <Text style={{ fontSize: 40 }}>📺</Text>
          </View>
        )}

        <View style={styles.heroInfo}>
          <Text style={styles.title}>{show.title}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>
              {show.year}{show.endYear ? `–${show.endYear}` : ''}
            </Text>
            {live && (
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
          </View>
          <Text style={styles.meta}>{show.genres.join(', ')}</Text>
          {show.network && <Text style={styles.meta}>{show.network}</Text>}
          <Text style={styles.meta}>
            {show.seasons} seasons · {show.totalEpisodes} episodes
          </Text>

          <View style={styles.ratingRow}>
            <RatingBadge rating={show.overallRating} size="lg" />
            <Text style={styles.votes}>{formatVotes(show.totalRatings)} votes</Text>
          </View>
        </View>
      </View>

      {/* Summary */}
      {show.summary && (
        <View style={styles.section}>
          <Text style={styles.summary}>{show.summary}</Text>
        </View>
      )}

      {/* Seasons & Episodes */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Episodes</Text>
        {show.episodes.map((season) => (
          <SeasonBlock
            key={season.s}
            season={season}
            expanded={expandedSeason === season.s}
            onToggle={() => setExpandedSeason(
              expandedSeason === season.s ? null : season.s
            )}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function SeasonBlock({ season, expanded, onToggle }: {
  season: Season;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = SEASON_COLORS[(season.s - 1) % SEASON_COLORS.length];
  const avgRating = season.eps.reduce((sum, ep) => sum + ep.r, 0) / season.eps.length;

  return (
    <View style={styles.seasonBlock}>
      <Pressable style={styles.seasonHeader} onPress={onToggle}>
        <View style={[styles.seasonDot, { backgroundColor: color }]} />
        <Text style={styles.seasonTitle}>Season {season.s}</Text>
        <Text style={styles.seasonMeta}>
          {season.eps.length} eps · {avgRating.toFixed(1)} avg
        </Text>
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>

      {expanded && season.eps.map((ep) => (
        <View key={ep.e} style={styles.episodeRow}>
          <Text style={styles.epNumber}>E{ep.e}</Text>
          <Text style={styles.epTitle} numberOfLines={1}>{ep.t}</Text>
          <Text style={[styles.epRating, { color: getRatingColor(ep.r) }]}>
            {ep.r.toFixed(1)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  content: {
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    backgroundColor: theme.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    color: '#f87171',
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
  },
  errorHint: {
    color: theme.textFaint,
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    marginTop: 4,
  },

  // Hero
  hero: {
    flexDirection: 'row',
    padding: 20,
    gap: 16,
  },
  poster: {
    width: 120,
    height: 170,
    borderRadius: 8,
  },
  posterPlaceholder: {
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroInfo: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 20,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  meta: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(74,222,128,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#4ade80',
  },
  liveText: {
    fontSize: 10,
    fontFamily: 'DMSans_700Bold',
    color: '#4ade80',
    letterSpacing: 0.5,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  votes: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },

  // Summary
  section: {
    paddingHorizontal: 20,
    marginTop: 16,
  },
  summary: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    lineHeight: 22,
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 12,
  },

  // Seasons
  seasonBlock: {
    marginBottom: 8,
  },
  seasonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  seasonDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  seasonTitle: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  seasonMeta: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    flex: 1,
  },
  chevron: {
    fontSize: 14,
    color: theme.textDim,
  },

  // Episodes
  episodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingLeft: 20,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  epNumber: {
    fontSize: 12,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
    width: 28,
  },
  epTitle: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
    flex: 1,
  },
  epRating: {
    fontSize: 13,
    fontFamily: 'DMSans_700Bold',
  },
});
