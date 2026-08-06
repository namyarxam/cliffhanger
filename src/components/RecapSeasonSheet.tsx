// Season picker for a recap card.
//
// The card's hero opens the latest finished season — the moment the feature
// exists for. Everything further back lives here, behind one "Earlier seasons"
// row, instead of the old inline chip rail: chips were sub-44pt targets in a
// horizontal scroll, so anything past ~S6 was invisible and reaching S2 on a
// ten-season show meant aiming at a pill mid-swipe.
//
// A sheet trades one extra tap on the rare path for full-width rows that
// scroll vertically like everything else. It also has room the rail never
// had: the top row plays the whole story so far as a single recap, which
// get_recap has supported all along (from/through are range parameters) but
// no surface offered.
import { useMemo } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import { estimateMinutes } from '@/src/recap/types';
import type { SeasonRange } from '@/src/recap/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Highest season the viewer has finished; rows cover 1..maxSeason-1. */
  maxSeason: number;
  onSelect: (range: SeasonRange) => void;
}

// A season contributes ~7 beats; the range as a whole adds a title card,
// ~6 character cards and a cliffhanger (both from its last season).
const rangeMinutes = (seasons: number) => estimateMinutes(8 + 7 * seasons);

export default function RecapSeasonSheet({ visible, onClose, title, maxSeason, onSelect }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  // Most recent first — someone reaching past the hero is most likely headed
  // for the season just before it, so that row sits on top.
  const earlier = useMemo(() => {
    const list: SeasonRange[] = [];
    for (let s = maxSeason - 1; s >= 1; s--) list.push({ from: s, through: s });
    return list;
  }, [maxSeason]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        {/* Stop scrim-press dismissal from firing on taps inside the panel. */}
        <Pressable style={[styles.panel, { paddingBottom: 16 + insets.bottom }]} onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.panelTitle} numberOfLines={1}>
            {title}
          </Text>

          <ScrollView style={styles.rows} bounces={false}>
            {maxSeason >= 2 && (
              <>
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => onSelect({ from: 1, through: maxSeason })}
                >
                  <FontAwesome name="book" size={14} color={theme.accent} style={styles.rowIcon} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>Seasons 1–{maxSeason}</Text>
                    <Text style={styles.rowMeta}>{rangeMinutes(maxSeason)} min</Text>
                  </View>
                  <FontAwesome name="play" size={11} color={theme.textFaint} />
                </Pressable>
                <View style={styles.divider} />
              </>
            )}

            {earlier.map(r => (
              <Pressable
                key={r.from}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => onSelect(r)}
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>Season {r.from}</Text>
                  <Text style={styles.rowMeta}>{rangeMinutes(1)} min</Text>
                </View>
                <FontAwesome name="play" size={11} color={theme.textFaint} />
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    panel: {
      backgroundColor: theme.bg,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingTop: 10,
      paddingHorizontal: 20,
      // Ten-season shows scroll inside the panel instead of growing it past
      // the reachable half of the screen.
      maxHeight: '62%',
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.border,
      marginBottom: 14,
    },
    panelTitle: {
      fontSize: 17,
      fontFamily: 'DMSans_700Bold',
      color: theme.text,
      marginBottom: 6,
    },
    rows: {
      flexGrow: 0,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
    },
    rowPressed: {
      opacity: 0.55,
    },
    rowIcon: {
      width: 18,
      textAlign: 'center',
    },
    rowBody: {
      flex: 1,
      gap: 2,
    },
    rowTitle: {
      fontSize: 15,
      fontFamily: 'DMSans_600SemiBold',
      color: theme.text,
    },
    rowMeta: {
      fontSize: 12,
      fontFamily: 'DMSans_400Regular',
      color: theme.textDim,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.border,
    },
  });
