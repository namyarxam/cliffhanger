import { memo, useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutAnimation } from 'react-native';
import { Image } from 'expo-image';
import { theme, SEASON_COLORS } from '@/src/lib/theme';
import type { Season } from '@/src/lib/types';

interface Props {
  seasons: Season[];
  watchedEps: Set<string>;
  currentSeason: number;
  currentEpisode: number;
  onEpisodeTap: (season: number, episode: number) => void;
  readOnly?: boolean;
}

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default memo(function EpisodePicker({
  seasons,
  watchedEps,
  currentSeason,
  currentEpisode,
  onEpisodeTap,
  readOnly = false,
}: Props) {
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [expandedEpisode, setExpandedEpisode] = useState<number | null>(null);
  const today = getToday();

  useEffect(() => {
    if (seasons.length === 1) {
      setSelectedSeason(seasons[0].number);
    } else if (currentSeason > 0) {
      setSelectedSeason(currentSeason);
    }
  }, [seasons, currentSeason]);

  const handleSelectSeason = (num: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectedSeason(num);
    setExpandedEpisode(null);
  };

  const handleBack = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectedSeason(null);
    setExpandedEpisode(null);
  };

  const handleToggleEpisode = (epNum: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedEpisode(expandedEpisode === epNum ? null : epNum);
  };

  const activeSeason = seasons.find(s => s.number === selectedSeason);

  // Season list view
  if (!activeSeason || (seasons.length > 1 && selectedSeason === null)) {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionTitle}>Episodes</Text>
        {seasons.map(season => {
          const color = SEASON_COLORS[(season.number - 1) % SEASON_COLORS.length];
          const watched = season.episodes.filter(
            ep => watchedEps.has(`S${season.number}E${ep.number}`)
          ).length;
          const total = season.episodes.length;
          const allWatched = watched === total && total > 0;

          return (
            <Pressable
              key={season.number}
              style={({ pressed }) => [styles.seasonRow, pressed && styles.rowPressed]}
              onPress={() => handleSelectSeason(season.number)}
            >
              <View style={[styles.seasonBadge, { backgroundColor: `${color}20` }]}>
                <Text style={[styles.seasonBadgeText, { color }]}>S{season.number}</Text>
              </View>
              <View style={styles.seasonInfo}>
                <Text style={styles.seasonName}>Season {season.number}</Text>
                <Text style={styles.seasonMeta}>{total} episodes</Text>
              </View>
              <Text style={[styles.seasonProgress, allWatched && styles.seasonProgressDone]}>
                {watched > 0 ? `${watched}/${total}` : ''}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  // Episode list view
  return (
    <View style={styles.container}>
      {seasons.length > 1 && (
        <Pressable style={styles.backRow} onPress={handleBack}>
          <Text style={styles.backText}>‹ All Seasons</Text>
        </Pressable>
      )}
      <Text style={styles.sectionTitle}>Season {activeSeason.number}</Text>

      {activeSeason.episodes.map(ep => {
        const key = `S${activeSeason.number}E${ep.number}`;
        const isWatched = watchedEps.has(key);
        const isFuture = ep.airdate ? ep.airdate > today : false;
        const isExpanded = expandedEpisode === ep.number;

        return (
          <View key={ep.number}>
            {/* Compact row */}
            <Pressable
              style={[
                styles.episodeRow,
                isFuture && styles.episodeRowFuture,
                isExpanded && styles.episodeRowExpanded,
              ]}
              onPress={() => !isFuture && handleToggleEpisode(ep.number)}
            >
              <View style={styles.thumbWrap}>
                {ep.image ? (
                  <Image source={{ uri: ep.image }} style={styles.thumb} contentFit="cover" />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]}>
                    <Text style={styles.thumbText}>E{ep.number}</Text>
                  </View>
                )}
              </View>

              <View style={styles.episodeInfo}>
                <Text style={[styles.episodeTitle, isFuture && styles.textFuture]} numberOfLines={1}>
                  <Text style={styles.episodeNumber}>E{ep.number} </Text>
                  {ep.title}
                </Text>
                {ep.airdate && (
                  <Text style={[styles.episodeDate, isFuture && styles.textFuture]}>
                    {isFuture ? 'Upcoming · ' : ''}{formatDate(ep.airdate)}
                  </Text>
                )}
              </View>

              {!isFuture && (
                <Pressable
                  style={[
                    styles.watchDot,
                    isWatched && styles.watchDotFilled,
                  ]}
                  onPress={(e) => {
                    e.stopPropagation();
                    if (!readOnly) onEpisodeTap(activeSeason.number, ep.number);
                  }}
                  disabled={readOnly}
                >
                  {isWatched && <Text style={styles.watchCheck}>✓</Text>}
                </Pressable>
              )}
            </Pressable>

            {/* Expanded detail */}
            {isExpanded && (
              <View style={styles.expandedDetail}>
                {(ep.imageOriginal || ep.image) && (
                  <Image
                    source={{ uri: ep.imageOriginal || ep.image! }}
                    style={styles.expandedImage}
                    contentFit="cover"
                  />
                )}
                <Text style={styles.expandedTitle}>
                  S{activeSeason.number} E{ep.number} — {ep.title}
                </Text>
                {ep.airdate && (
                  <Text style={styles.expandedDate}>{formatDate(ep.airdate)}</Text>
                )}
                {ep.summary && (
                  <Text style={styles.expandedSummary}>{ep.summary}</Text>
                )}
                {!isFuture && !readOnly && (
                  <Pressable
                    style={[
                      styles.markButton,
                      isWatched && styles.markButtonWatched,
                    ]}
                    onPress={() => onEpisodeTap(activeSeason.number, ep.number)}
                  >
                    <Text style={[
                      styles.markButtonText,
                      isWatched && styles.markButtonTextWatched,
                    ]}>
                      {isWatched ? 'Watched up to here' : 'Mark watched up to here'}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 12,
  },
  backRow: {
    marginBottom: 8,
  },
  backText: {
    fontSize: 15,
    fontFamily: 'DMSans_500Medium',
    color: theme.accent,
  },

  // Season rows
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 12,
  },
  rowPressed: {
    backgroundColor: theme.bgCard,
  },
  seasonBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  seasonBadgeText: {
    fontSize: 12,
    fontFamily: 'DMSans_700Bold',
  },
  seasonInfo: {
    flex: 1,
    gap: 2,
  },
  seasonName: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  seasonMeta: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },
  seasonProgress: {
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
    color: theme.textFaint,
  },
  seasonProgressDone: {
    color: theme.success,
  },
  chevron: {
    fontSize: 20,
    color: theme.textDim,
  },

  // Episode rows
  episodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 12,
  },
  episodeRowFuture: {
    opacity: 0.4,
  },
  episodeRowExpanded: {
    borderBottomWidth: 0,
  },
  thumbWrap: {
    borderRadius: 4,
    overflow: 'hidden',
  },
  thumb: {
    width: 60,
    height: 34,
  },
  thumbPlaceholder: {
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  thumbText: {
    fontSize: 10,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
  },
  episodeInfo: {
    flex: 1,
    gap: 2,
  },
  episodeNumber: {
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
  },
  episodeTitle: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
  },
  episodeDate: {
    fontSize: 11,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },
  textFuture: {
    color: theme.textFaint,
  },
  watchDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchDotFilled: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  watchCheck: {
    color: theme.textBright,
    fontSize: 12,
    fontWeight: '700',
  },

  // Expanded detail
  expandedDetail: {
    backgroundColor: theme.bgCard,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  expandedImage: {
    width: '100%',
    height: 160,
    borderRadius: 8,
    marginBottom: 12,
  },
  expandedTitle: {
    fontSize: 15,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
    marginBottom: 4,
  },
  expandedDate: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    marginBottom: 8,
  },
  expandedSummary: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    lineHeight: 20,
    marginBottom: 12,
  },
  markButton: {
    backgroundColor: theme.accent,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  markButtonWatched: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: theme.border,
  },
  markButtonText: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textBright,
  },
  markButtonTextWatched: {
    color: theme.textDim,
  },
});
