// Recap index — the list of shows you can catch up on.
//
// Deliberately more image-led than the rest of the app's list screens: the
// visual shift starts here rather than at the story itself, so tapping in
// doesn't feel like a different app. Cards are 16:9 backdrops with the copy
// sitting on a gradient scrim instead of the usual poster-thumb + text row.
//
// Each season is its own recap. The hero opens the latest finished one — the
// moment the feature exists for — and every earlier season lives behind one
// "Earlier seasons" row that opens a bottom sheet (RecapSeasonSheet). The
// sheet replaced an inline chip rail whose sub-44pt targets hid everything
// past ~S6 behind a horizontal scroll.

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
import { estimateMinutes } from '@/src/recap/types';
import type { SeasonRange } from '@/src/recap/types';
import RecapSeasonSheet from '@/src/components/RecapSeasonSheet';

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
   * Two groups, on `tier` from the server (migrations 069 + 070):
   *
   *   live (0)   a recap you have earned, with show still ahead of you
   *   spent (2)  the show has ended and you have seen all of it. The recap
   *              still exists but the moment for it has passed.
   *
   * There was a third — recaps you had not unlocked — and removing it is what
   * made this screen simple. It held untracked shows, shows with no season
   * finished, and muted shows, none of which the viewer could open, and all
   * of which had to be labelled and filtered around. 070 stops returning them.
   *
   * What is left needs one expander, not a filter: everything visible by
   * default is openable, and the single collapsed group has a name that
   * explains itself.
   *
   * The split is deliberately NOT re-derived here — the server computes it
   * next to the ordering it has to agree with.
   */
  const [active, spent] = useMemo(() => {
    const a: RecapListEntry[] = [];
    const s: RecapListEntry[] = [];
    for (const r of recaps) (r.tier === 2 ? s : a).push(r);
    return [a, s];
  }, [recaps]);

  const [showSpent, setShowSpent] = useState(false);

  // The show whose earlier seasons are open in the picker sheet. One sheet
  // for the screen, not one per card — only one can be open, and hoisting it
  // keeps a Modal out of every list row.
  const [picker, setPicker] = useState<RecapListEntry | null>(null);

  useEffect(() => {
    if (recapsQ.error) silentCatch('recap:list')(recapsQ.error);
  }, [recapsQ.error]);

  // Warm the cache for everything this viewer is already entitled to.
  //
  // You want a season's recap roughly a year after finishing it, when the
  // next season airs — never at the moment you catch up. So fetching quietly
  // here means the data is on the device long before anyone asks for it, and
  // the server-side season cap costs nothing in felt speed.
  //
  // Spent shows are excluded: they sit behind a collapsed control and are
  // opened rarely, so warming them is bandwidth spent on the least likely tap
  // on the screen. They still fetch on demand.
  useEffect(() => {
    for (const entry of recaps) if (entry.tier !== 2) void prefetchRecap(entry);
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
        {/* The one door to everything not on this screen: shows with recaps
            you aren't tracking yet, and shows with no recap to request. All
            recap surface area lives inside this tab by design. */}
        <Pressable
          style={({ pressed }) => [styles.searchPill, pressed && styles.morePressed]}
          onPress={() => router.push('/recap/search')}
          hitSlop={4}
        >
          <FontAwesome name="search" size={13} color={theme.textDim} />
          <Text style={styles.searchPillText}>Find or request a recap</Text>
        </Pressable>

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
            onOpenPicker={() => setPicker(item)}
          />
        ))}

        {/* One control, named for what is behind it. "Finished" is doing the
            work a sub-heading had to do in the two-section version — with a
            single group there is nothing to disambiguate it against. */}
        {spent.length > 0 && (
          <Pressable
            style={({ pressed }) => [styles.moreRow, pressed && styles.morePressed]}
            onPress={() => setShowSpent(v => !v)}
            hitSlop={6}
          >
            <Text style={styles.moreText}>
              {showSpent ? 'Hide finished' : `${spent.length} finished`}
            </Text>
            <FontAwesome
              name={showSpent ? 'chevron-up' : 'chevron-down'}
              size={10}
              color={theme.textDim}
            />
          </Pressable>
        )}

        {showSpent &&
          spent.map(item => (
            <RecapCard
              key={item.slug}
              item={item}
              styles={styles}
              theme={theme}
              onOpen={range => open(item.slug, range)}
              onOpenPicker={() => setPicker(item)}
            />
          ))}

        {!recapsQ.isLoading && !recapsQ.isError && (
          <Pressable style={styles.note} onPress={() => router.push('/recap/search')} hitSlop={6}>
            <FontAwesome name="info-circle" size={13} color={theme.textFaint} />
            <Text style={styles.noteText}>
              Recaps only ever cover seasons you've finished, so they can't
              spoil what's ahead of you. Missing a show?{' '}
              <Text style={{ color: theme.accent }}>Find or request it.</Text>
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <RecapSeasonSheet
        visible={picker != null}
        title={picker?.title ?? ''}
        maxSeason={picker?.maxSeason ?? 0}
        onClose={() => setPicker(null)}
        onSelect={range => {
          const slug = picker?.slug;
          setPicker(null);
          if (slug) open(slug, range);
        }}
      />
    </View>
  );
}

/**
 * Why a card has nothing to offer.
 *
 * A fallback, not a normal state. Since 070 the server does not return
 * unopenable recaps, so this should not render — but the list is cached, and
 * a show muted on another device can sit in that cache until the next fetch.
 * A card that explains itself beats one that silently does nothing when
 * tapped.
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
  onOpenPicker,
}: {
  item: RecapListEntry;
  styles: ReturnType<typeof createStyles>;
  theme: Theme;
  onOpen: (range: SeasonRange) => void;
  onOpenPicker: () => void;
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

      {/* Earlier seasons only — the latest one is the card itself. A single
          full-width row into a bottom sheet (RecapSeasonSheet): the count is
          unbounded (The Walking Dead offers ten), and the sheet's vertical
          list holds any number of full-size targets where the old chip rail
          hid everything past the screen edge. */}
      {earlier.length > 0 && (
        <Pressable
          style={({ pressed }) => [styles.earlierRow, pressed && { backgroundColor: theme.accentBg }]}
          onPress={onOpenPicker}
        >
          <FontAwesome name="history" size={13} color={theme.textFaint} />
          <Text style={styles.earlierText}>Earlier seasons</Text>
          <FontAwesome name="chevron-right" size={10} color={theme.textFaint} />
        </Pressable>
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
    searchPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.bgCard,
    },
    searchPillText: {
      fontSize: 13,
      fontFamily: 'DMSans_500Medium',
      color: theme.textDim,
    },
    moreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      // Hugs its text instead of spanning the list, so it reads as a control
      // rather than a row. alignSelf beats a width, which would have to be
      // re-guessed every time the label or the count's digit width changes.
      alignSelf: 'center',
      paddingVertical: 9,
      paddingHorizontal: 16,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.bgCard,
      marginVertical: 4,
    },
    morePressed: {
      opacity: 0.6,
    },
    moreText: {
      fontSize: 13,
      fontFamily: 'DMSans_500Medium',
      color: theme.textDim,
      fontVariant: ['tabular-nums'],
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
    earlierRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 16,
      paddingVertical: 13,
    },
    earlierText: {
      flex: 1,
      fontSize: 13,
      fontFamily: 'DMSans_500Medium',
      color: theme.textDim,
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
