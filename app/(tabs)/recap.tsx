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

import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { listRecaps, buildFrames } from '@/src/recap/registry';
import { offeredRanges, rangeLabel, estimateMinutes } from '@/src/recap/types';
import type { RecapMeta, SeasonRange } from '@/src/recap/types';

export default function RecapScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const recaps = useMemo(() => listRecaps(), []);

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
        {recaps.map(item => (
          <RecapCard
            key={item.slug}
            item={item}
            styles={styles}
            theme={theme}
            onOpen={range => open(item.slug, range)}
          />
        ))}

        {/* Honest empty-state framing: the prototype has exactly one show, and
            pretending otherwise would hide the coverage problem that the real
            feature has to solve. */}
        <View style={styles.note}>
          <FontAwesome name="info-circle" size={13} color={theme.textFaint} />
          <Text style={styles.noteText}>
            More shows coming. Recaps are built per season, so they never spoil
            past the season you pick.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function RecapCard({
  item,
  styles,
  theme,
  onOpen,
}: {
  item: RecapMeta;
  styles: ReturnType<typeof createStyles>;
  theme: Theme;
  onOpen: (range: SeasonRange) => void;
}) {
  const ranges = useMemo(() => offeredRanges(item.availableSeasons), [item.availableSeasons]);
  const fullRange = ranges[ranges.length - 1];
  const minutes = useMemo(
    () => estimateMinutes(buildFrames(item.slug, fullRange).length),
    [item.slug, fullRange],
  );

  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.cardHero, pressed && styles.cardPressed]}
        onPress={() => onOpen(fullRange)}
      >
        <Image
          source={{ uri: item.backdrop }}
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
              {item.availableSeasons.length} seasons available · {minutes} min
            </Text>
          </View>
          <View style={[styles.playChip, { backgroundColor: theme.accent }]}>
            <FontAwesome name="play" size={11} color="#fff" />
          </View>
        </View>
      </Pressable>

      <View style={styles.chipRow}>
        <Text style={styles.chipLabel}>Recap</Text>
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
