// Recap index — the list of shows you can catch up on.
//
// Deliberately more image-led than the rest of the app's list screens: the
// visual shift starts here rather than at the story itself, so tapping in
// doesn't feel like a different app. Cards are 16:9 backdrops with the copy
// sitting on a gradient scrim instead of the usual poster-thumb + text row.
//
// Each season is its own recap, so the card carries a row of range chips
// (S1 / S2 / S1–S2). The chips ARE the entry points — tapping one starts that
// recap directly rather than selecting-then-confirming, which would add a tap
// for no information gain. The play button starts the full span.

import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/providers/AuthProvider';
import { qk } from '@/src/lib/queryKeys';
import { silentCatch } from '@/src/lib/errorLog';
import { listRecaps, offeredRangesFor, prefetchRecap } from '@/src/lib/recaps';
import type { RecapListEntry } from '@/src/lib/recaps';
import { rangeLabel, estimateMinutes } from '@/src/recap/types';
import type { SeasonRange } from '@/src/recap/types';

export default function RecapScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const recapsQ = useQuery({
    queryKey: qk.recaps(userId),
    queryFn: listRecaps,
    enabled: !!userId,
  });
  const recaps = recapsQ.data ?? [];

  /**
   * Two tiers: what's worth recapping now, and everything else.
   *
   * A recap earns a full card when it is both available and still ahead of
   * you — you have finished a season and there is more show to come. Once a
   * show is finished, or you have not started it, the recap still exists but
   * the moment for it does not, so it goes below the fold rather than
   * competing for attention with the ones that are actually useful.
   *
   * Collapsed rather than hidden because the ratio only gets worse as the
   * library grows: at 100 shows a typical viewer has a handful of live ones
   * and everything else is either finished or untracked, and a wall of locked
   * cards is not a list.
   */
  const [active, dormant] = useMemo(() => {
    const a: RecapListEntry[] = [];
    const d: RecapListEntry[] = [];
    for (const r of recaps) {
      (r.maxSeason > 0 && r.watchStatus !== 'watched' ? a : d).push(r);
    }
    return [a, d];
  }, [recaps]);

  const [showDormant, setShowDormant] = useState(false);

  useEffect(() => {
    if (recapsQ.error) silentCatch('recap:list')(recapsQ.error);
  }, [recapsQ.error]);

  // Warm the cache for everything this viewer is already entitled to.
  //
  // You want a season's recap roughly a year after finishing it, when the
  // next season airs — never at the moment you catch up. So fetching quietly
  // here means the data is on the device long before anyone asks for it, and
  // the server-side season cap costs nothing in felt speed.
  useEffect(() => {
    for (const entry of recaps) void prefetchRecap(entry);
  }, [recaps]);

  const open = (slug: string, range: SeasonRange) =>
    router.push(`/recap/${slug}?from=${range.from}&through=${range.through}`);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        // Scroll/bounce even when the content is shorter than the viewport, so
        // the surface always feels live rather than locked.
        alwaysBounceVertical
      >
        {recapsQ.isLoading && (
          <View style={styles.stateBox}>
            <ActivityIndicator color={theme.textDim} />
          </View>
        )}

        {recapsQ.isError && !recapsQ.isLoading && (
          <View style={styles.stateBox}>
            <Text style={styles.stateText}>Couldn't load recaps.</Text>
            <Pressable onPress={() => recapsQ.refetch()} hitSlop={8}>
              <Text style={[styles.stateText, { color: theme.accent }]}>Try again</Text>
            </Pressable>
          </View>
        )}

        {active.map(item => (
          <RecapCard
            key={item.slug}
            item={item}
            styles={styles}
            theme={theme}
            onOpen={range => open(item.slug, range)}
          />
        ))}

        {dormant.length > 0 && (
          <>
            <Pressable
              style={styles.moreRow}
              onPress={() => setShowDormant(v => !v)}
              hitSlop={6}
            >
              <Text style={styles.moreText}>
                {showDormant ? 'Hide' : `${dormant.length} more`}
              </Text>
              <FontAwesome
                name={showDormant ? 'chevron-up' : 'chevron-down'}
                size={11}
                color={theme.textDim}
              />
            </Pressable>

            {showDormant &&
              dormant.map(item => (
                <RecapCard
                  key={item.slug}
                  item={item}
                  styles={styles}
                  theme={theme}
                  onOpen={range => open(item.slug, range)}
                />
              ))}
          </>
        )}

        {!recapsQ.isLoading && !recapsQ.isError && (
          <View style={styles.note}>
            <FontAwesome name="info-circle" size={13} color={theme.textFaint} />
            <Text style={styles.noteText}>
              More shows coming. Recaps only ever cover seasons you've finished,
              so they can't spoil what's ahead of you.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Why a card has nothing to offer yet.
 *
 * Stated plainly rather than hiding the card: a recap for a show you haven't
 * started is just a spoiler, but "we have this, finish a season and it opens"
 * is useful information and a reason to add the show.
 */
function lockedReason(item: RecapListEntry): string {
  if (item.watchStatus === 'muted') return 'Muted';
  if (!item.watchStatus) return 'Add this show to unlock';
  return 'Finish a season to unlock';
}

function RecapCard({
  item,
  styles,
  theme,
  onOpen,
}: {
  item: RecapListEntry;
  styles: ReturnType<typeof createStyles>;
  theme: Theme;
  onOpen: (range: SeasonRange) => void;
}) {
  // Bounded by the viewer's own progress, not by what we hold. maxSeason is
  // 0 when the show isn't tracked, is muted, or no season has been finished —
  // in which case there is nothing to offer and the card renders locked.
  const ranges = useMemo(() => offeredRangesFor(item.maxSeason), [item.maxSeason]);
  // The hero opens the LATEST finished season, not the whole series. That is
  // the moment the feature exists for: a new season is coming and the one
  // before it has gone. Earlier seasons are still reachable below, they are
  // just not the default.
  const latest = ranges[ranges.length - 1] ?? null;
  const earlier = ranges.slice(0, -1);
  const locked = ranges.length === 0;

  // Estimated from season count rather than an actual frame list, since the
  // frames for a range aren't fetched until it's opened. Every season is a
  // title + premise + ~6 character cards + ~7 beats + a cliffhanger.
  // One season: a title card, ~6 character cards, ~7 beats, a cliffhanger.
  // Previously scaled by every season the viewer had unlocked, which was the
  // whole-series figure and no longer describes what the button does.
  const minutes = useMemo(() => estimateMinutes(1 + 6 + 7 + 1), []);

  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.cardHero, pressed && !locked && styles.cardPressed]}
        onPress={() => latest && onOpen(latest)}
        disabled={locked}
      >
        <Image
          source={{ uri: item.backdrop ?? item.poster ?? undefined }}
          style={styles.cardImage}
          contentFit="cover"
          transition={220}
        />
        {/* Scrim carries the text — without it, copy over a bright still is
            unreadable and no amount of text-shadow fixes it reliably. */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.88)']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />

        {/* Which season this card opens. The hero used to run the whole
            series, so the button's scope was implicit; now that it is one
            specific season it has to say which, or tapping is a guess. Sits
            top-left, away from the play chip and clear of the bottom gradient
            that carries the title. */}
        {!locked && (
          <View style={styles.seasonBadge}>
            <Text style={styles.seasonBadgeText}>SEASON {item.maxSeason}</Text>
          </View>
        )}

        <View style={styles.cardBody}>
          <View style={styles.cardCopy}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardMeta}>
              {locked ? lockedReason(item) : `Season ${item.maxSeason} · ${minutes} min`}
            </Text>
          </View>
          <View style={[styles.playChip, { backgroundColor: locked ? 'rgba(255,255,255,0.12)' : theme.accent }]}>
            <FontAwesome name={locked ? 'lock' : 'play'} size={11} color={locked ? theme.textDim : '#fff'} />
          </View>
        </View>
      </Pressable>

      {/* Earlier seasons only — the latest one is the card itself. Horizontal
          scroll because the count is unbounded: The Walking Dead offers ten
          here, which runs past the screen edge and would otherwise be
          unreachable. */}
      {earlier.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          // The row sits inside a vertically scrolling list; without this a
          // near-vertical drag starting on a chip gets captured here and the
          // page stops scrolling.
          directionalLockEnabled
        >
          <Text style={styles.chipLabel}>Earlier</Text>
          {earlier.map(r => (
            <Pressable
              key={rangeLabel(r)}
              onPress={() => onOpen(r)}
              style={({ pressed }) => [styles.chip, pressed && { backgroundColor: theme.accentBg }]}
              hitSlop={4}
            >
              <Text style={styles.chipText}>{rangeLabel(r)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    list: {
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 32,
      gap: 14,
      // Guarantees the scroll view has at least a full screen of content box,
      // so alwaysBounceVertical has something to bounce.
      flexGrow: 1,
    },
    moreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingVertical: 14,
    },
    moreText: {
      fontSize: 13,
      fontFamily: 'DMSans_500Medium',
      color: theme.textDim,
    },
    seasonBadge: {
      position: 'absolute',
      top: 12,
      left: 12,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 6,
      // Its own scrim rather than relying on the gradient, which is weighted
      // to the bottom of the card where the title sits.
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    seasonBadgeText: {
      fontSize: 11,
      fontFamily: 'DMSans_700Bold',
      color: 'rgba(255,255,255,0.95)',
      letterSpacing: 1.1,
    },
    stateBox: {
      paddingVertical: 40,
      alignItems: 'center',
      gap: 10,
    },
    stateText: {
      fontSize: 14,
      fontFamily: 'DMSans_400Regular',
      color: theme.textDim,
    },
    card: {
      borderRadius: 18,
      overflow: 'hidden',
      backgroundColor: theme.bgCard,
    },
    cardHero: {
      height: 200,
    },
    cardPressed: {
      opacity: 0.85,
    },
    cardImage: {
      ...StyleSheet.absoluteFillObject,
    },
    cardBody: {
      flex: 1,
      justifyContent: 'flex-end',
      flexDirection: 'row',
      alignItems: 'flex-end',
      padding: 16,
      gap: 12,
    },
    cardCopy: {
      flex: 1,
    },
    cardTitle: {
      fontSize: 24,
      fontFamily: 'DMSans_700Bold',
      // Always light — this sits on photography, not on theme.bg, so it must
      // not follow the Paper theme's dark text.
      color: '#fff',
      letterSpacing: -0.3,
    },
    cardMeta: {
      fontSize: 13,
      fontFamily: 'DMSans_500Medium',
      color: 'rgba(255,255,255,0.72)',
      marginTop: 3,
    },
    playChip: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      // Nudge the glyph optically centred — a play triangle's visual centre
      // sits left of its bounding box.
      paddingLeft: 3,
    },
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    chipLabel: {
      fontSize: 12,
      fontFamily: 'DMSans_500Medium',
      color: theme.textDim,
      marginRight: 2,
    },
    chip: {
      paddingHorizontal: 13,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.bgDarker,
    },
    chipText: {
      fontSize: 13,
      fontFamily: 'DMSans_700Bold',
      color: theme.text,
    },
    note: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 4,
      paddingTop: 6,
      alignItems: 'flex-start',
    },
    noteText: {
      flex: 1,
      fontSize: 12,
      fontFamily: 'DMSans_400Regular',
      color: theme.textFaint,
      lineHeight: 17,
    },
  });
