import { useMemo, useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { theme, SEASON_COLORS } from '@/src/lib/theme';
import type { Season } from '@/src/lib/types';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface FlatEpisode {
  season: number;
  episode: number;
  title: string;
  airdate: string | null;
  isSeasonStart: boolean;
  globalIndex: number;
  isFuture: boolean;
  isLastAired: boolean;
}

interface Props {
  seasons: Season[];
  totalEpisodes: number;
  watchedEps: Set<string>;
  currentSeason: number;
  currentEpisode: number;
  onEpisodeTap: (season: number, episode: number) => void;
}

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function EpisodeTimeline({
  seasons,
  totalEpisodes,
  watchedEps,
  currentSeason,
  currentEpisode,
  onEpisodeTap,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const [selectedEp, setSelectedEp] = useState<FlatEpisode | null>(null);
  const dotPositions = useRef<Record<number, number>>({});
  const hasScrolled = useRef(false);
  const prevSeasonsRef = useRef(seasons);

  // Reset state when show changes
  if (prevSeasonsRef.current !== seasons) {
    prevSeasonsRef.current = seasons;
    hasScrolled.current = false;
  }

  // Flatten all episodes into a linear array, marking future and last-aired
  const flatEpisodes = useMemo(() => {
    const today = getToday();
    const flat: FlatEpisode[] = [];
    let idx = 0;
    for (const season of seasons) {
      for (let i = 0; i < season.episodes.length; i++) {
        const ep = season.episodes[i];
        const isFuture = ep.airdate ? ep.airdate > today : false;
        flat.push({
          season: season.number,
          episode: ep.number,
          title: ep.title,
          airdate: ep.airdate,
          isSeasonStart: i === 0,
          globalIndex: idx,
          isFuture,
          isLastAired: false, // set below
        });
        idx++;
      }
    }

    // Find last aired episode (latest airdate <= today)
    let lastAiredIdx = -1;
    for (let i = flat.length - 1; i >= 0; i--) {
      if (!flat[i].isFuture && flat[i].airdate) {
        lastAiredIdx = i;
        break;
      }
    }
    if (lastAiredIdx >= 0) {
      flat[lastAiredIdx].isLastAired = true;
    }

    return flat;
  }, [seasons]);

  // Count aired episodes
  const airedCount = useMemo(
    () => flatEpisodes.filter(ep => !ep.isFuture).length,
    [flatEpisodes]
  );

  // Sizing based on total episodes
  const sizing = useMemo(() => {
    if (totalEpisodes > 200) return { dot: 6, gap: 2, hit: 20 };
    if (totalEpisodes > 100) return { dot: 8, gap: 3, hit: 24 };
    return { dot: 12, gap: 4, hit: 28 };
  }, [totalEpisodes]);

  // Find the current episode in the flat list for auto-scroll
  const currentIndex = useMemo(() => {
    if (currentSeason === 0 && currentEpisode === 0) return -1;
    return flatEpisodes.findIndex(
      ep => ep.season === currentSeason && ep.episode === currentEpisode
    );
  }, [flatEpisodes, currentSeason, currentEpisode]);

  // Auto-scroll to current position on mount only
  useEffect(() => {
    if (hasScrolled.current || currentIndex < 0) return;
    hasScrolled.current = true;
    const timer = setTimeout(() => {
      const x = dotPositions.current[currentIndex];
      if (x != null && scrollRef.current) {
        scrollRef.current.scrollTo({
          x: Math.max(0, x - SCREEN_WIDTH / 2 + sizing.dot / 2),
          animated: true,
        });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [currentIndex, sizing.dot]);

  // Reset selected episode when show changes, set to current if available
  useEffect(() => {
    if (currentIndex >= 0 && flatEpisodes[currentIndex]) {
      setSelectedEp(flatEpisodes[currentIndex]);
    } else {
      setSelectedEp(null);
    }
  }, [flatEpisodes]);

  const handleTap = (ep: FlatEpisode) => {
    if (ep.isFuture) return; // can't mark future episodes
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedEp(ep);
    onEpisodeTap(ep.season, ep.episode);
  };

  // Find upcoming episodes for airing shows
  const upcomingEpisodes = useMemo(() => {
    return flatEpisodes.filter(ep => ep.isFuture && ep.airdate).slice(0, 3);
  }, [flatEpisodes]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Progress</Text>
        {currentSeason > 0 ? (
          <Text style={styles.headerSubtitle}>
            S{currentSeason} E{currentEpisode} of {airedCount} aired episodes
          </Text>
        ) : (
          <Text style={styles.headerSubtitle}>
            {airedCount} aired · {totalEpisodes - airedCount > 0 ? `${totalEpisodes - airedCount} upcoming` : `${totalEpisodes} total`}
          </Text>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.timeline, { paddingHorizontal: 20 }]}
      >
        {flatEpisodes.map((ep, i) => {
          const key = `S${ep.season}E${ep.episode}`;
          const isWatched = watchedEps.has(key);
          const seasonColor = SEASON_COLORS[(ep.season - 1) % SEASON_COLORS.length];

          let dotColor: string;
          if (ep.isFuture) {
            dotColor = 'rgba(255,255,255,0.03)';
          } else if (isWatched) {
            dotColor = seasonColor;
          } else {
            dotColor = 'rgba(255,255,255,0.08)';
          }

          return (
            <View key={key} style={styles.dotContainer}>
              {/* Season label */}
              {ep.isSeasonStart && (
                <View style={styles.seasonLabelRow}>
                  {i > 0 && <View style={styles.seasonDivider} />}
                  <Text style={[styles.seasonLabel, { color: seasonColor }]}>
                    S{ep.season}
                  </Text>
                </View>
              )}

              {/* Dot */}
              <Pressable
                onLayout={(e) => {
                  dotPositions.current[ep.globalIndex] = e.nativeEvent.layout.x;
                }}
                onPress={() => handleTap(ep)}
                disabled={ep.isFuture}
                style={[
                  styles.hitArea,
                  { width: sizing.hit, height: sizing.hit },
                ]}
              >
                <View
                  style={[
                    styles.dot,
                    {
                      width: sizing.dot,
                      height: sizing.dot,
                      borderRadius: sizing.dot / 2,
                      backgroundColor: dotColor,
                    },
                  ]}
                />
                {/* Latest aired episode ring */}
                {ep.isLastAired && (
                  <View
                    style={[
                      styles.latestRing,
                      {
                        width: sizing.dot + 10,
                        height: sizing.dot + 10,
                        borderRadius: (sizing.dot + 10) / 2,
                      },
                    ]}
                  />
                )}
              </Pressable>
            </View>
          );
        })}
      </ScrollView>

      {/* Episode detail row */}
      {selectedEp && (
        <View style={styles.detailRow}>
          <Text style={styles.detailText}>
            S{selectedEp.season} E{selectedEp.episode}
            <Text style={styles.detailDim}> · {selectedEp.title}</Text>
            {selectedEp.airdate && (
              <Text style={styles.detailDim}> · {selectedEp.airdate}</Text>
            )}
          </Text>
        </View>
      )}

      {/* Upcoming episodes for airing shows */}
      {upcomingEpisodes.length > 0 && (
        <View style={styles.upcomingSection}>
          <Text style={styles.upcomingTitle}>Upcoming</Text>
          {upcomingEpisodes.map(ep => (
            <View key={`upcoming-${ep.season}-${ep.episode}`} style={styles.upcomingRow}>
              <Text style={styles.upcomingEp}>S{ep.season} E{ep.episode}</Text>
              <Text style={styles.upcomingName} numberOfLines={1}>{ep.title}</Text>
              <Text style={styles.upcomingDate}>{ep.airdate}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
    marginTop: 2,
  },
  timeline: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingBottom: 4,
  },
  dotContainer: {
    alignItems: 'center',
  },
  seasonLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 4,
  },
  seasonDivider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginRight: 4,
  },
  seasonLabel: {
    fontSize: 9,
    fontFamily: 'DMSans_700Bold',
    letterSpacing: 0.5,
  },
  hitArea: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    // size set dynamically
  },
  latestRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#f87171',
  },
  detailRow: {
    paddingHorizontal: 20,
    marginTop: 8,
  },
  detailText: {
    fontSize: 13,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.text,
  },
  detailDim: {
    fontFamily: 'DMSans_400Regular',
    color: theme.textDim,
  },

  // Upcoming
  upcomingSection: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  upcomingTitle: {
    fontSize: 14,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
    marginBottom: 8,
  },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  upcomingEp: {
    fontSize: 12,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textDim,
    width: 48,
  },
  upcomingName: {
    fontSize: 13,
    fontFamily: 'DMSans_400Regular',
    color: theme.text,
    flex: 1,
  },
  upcomingDate: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    color: theme.accent,
  },
});
