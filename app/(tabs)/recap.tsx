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

import { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const recapsQ = useQuery({
    queryKey: qk.recaps(userId),
    queryFn: listRecaps,
    enabled: !!userId,
  });
  const recaps = recapsQ.data ?? [];

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
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Recap</Text>
        <Text style={styles.subtitle}>Pick up where you left off</Text>
      </View>

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

        {recaps.map(item => (
          <RecapCard
            key={item.slug}
            item={item}
            styles={styles}
            theme={theme}
            onOpen={range => open(item.slug, range)}
          />
        ))}

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
  const fullRange = ranges[ranges.length - 1] ?? null;
  const locked = ranges.length === 0;

  // Estimated from season count rather than an actual frame list, since the
  // frames for a range aren't fetched until it's opened. Every season is a
  // title + premise + ~6 character cards + ~7 beats + a cliffhanger.
  const minutes = useMemo(
    () => estimateMinutes(2 + 6 + item.maxSeason * 7 + 1),
    [item.maxSeason],
  );

  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.cardHero, pressed && !locked && styles.cardPressed]}
        onPress={() => fullRange && onOpen(fullRange)}
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

        <View style={styles.cardBody}>
          <View style={styles.cardCopy}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardMeta}>
              {locked
                ? lockedReason(item)
                : `${item.maxSeason} season${item.maxSeason === 1 ? '' : 's'} · ${minutes} min`}
            </Text>
          </View>
          <View style={[styles.playChip, { backgroundColor: locked ? 'rgba(255,255,255,0.12)' : theme.accent }]}>
            <FontAwesome name={locked ? 'lock' : 'play'} size={11} color={locked ? theme.textDim : '#fff'} />
          </View>
        </View>
      </Pressable>

      <View style={styles.chipRow}>
        <Text style={styles.chipLabel}>{locked ? '' : 'Recap'}</Text>
        {ranges.map(r => (
          <Pressable
            key={rangeLabel(r)}
            onPress={() => onOpen(r)}
            style={({ pressed }) => [styles.chip, pressed && { backgroundColor: theme.accentBg }]}
            hitSlop={4}
          >
            <Text style={styles.chipText}>{rangeLabel(r)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    header: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 16,
    },
    title: {
      fontSize: 30,
      fontFamily: 'DMSans_700Bold',
      color: theme.textBright,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontSize: 14,
      fontFamily: 'DMSans_400Regular',
      color: theme.textDim,
      marginTop: 2,
    },
    list: {
      paddingHorizontal: 16,
      paddingBottom: 32,
      gap: 14,
      // Guarantees the scroll view has at least a full screen of content box,
      // so alwaysBounceVertical has something to bounce.
      flexGrow: 1,
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
