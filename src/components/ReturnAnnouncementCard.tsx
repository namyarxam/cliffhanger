import { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import type { ReturnAnnouncement } from '@/src/lib/watchlist';

interface Props {
  announcement: ReturnAnnouncement;
  onPress: (showId: string) => void;
  onDismiss: (showId: string) => void;
}

// "Soon" = within 5 days. Drives the celebration kicker + accent border AND
// the app icon badge. Outside the window the announcement still surfaces but
// in a subdued "coming back later" state.
const SOON_DAYS = 5;

function formatReturn(airdate: string | null): { label: string; isSoon: boolean } {
  if (!airdate) return { label: 'Coming back', isSoon: false };
  const epDate = new Date(airdate + 'T00:00:00');
  const now = new Date();
  const diffDays = Math.round((epDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const isSoon = diffDays >= 0 && diffDays <= SOON_DAYS;

  if (diffDays === 0) return { label: 'Returns today', isSoon };
  if (diffDays === 1) return { label: 'Returns tomorrow', isSoon };
  if (diffDays > 1 && diffDays < 7) return { label: `Returns in ${diffDays} days`, isSoon };
  const sameYear = epDate.getFullYear() === now.getFullYear();
  const formatted = epDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return { label: `Returns ${formatted}`, isSoon };
}

function ReturnAnnouncementCard({ announcement, onPress, onDismiss }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { label, isSoon } = formatReturn(announcement.next_episode_airdate);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        isSoon && styles.containerSoon,
        pressed && { opacity: 0.85 },
      ]}
      onPress={() => onPress(announcement.show_id)}
    >
      <View style={styles.posterWrap}>
        {announcement.show_image ? (
          <Image
            source={{ uri: announcement.show_image }}
            style={styles.poster}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]}>
            <Text style={styles.posterPlaceholderText}>📺</Text>
          </View>
        )}
      </View>

      <View style={styles.info}>
        <Text style={[styles.kicker, isSoon && styles.kickerSoon]}>
          {isSoon ? '🎉 BACK SOON' : 'COMING BACK'}
        </Text>
        <Text style={styles.title} numberOfLines={1}>{announcement.show_title}</Text>
        <Text style={styles.date}>{label}</Text>
      </View>

      <Pressable
        hitSlop={10}
        style={({ pressed }) => [styles.dismiss, pressed && { opacity: 0.5 }]}
        onPress={(e) => {
          e.stopPropagation();
          onDismiss(announcement.show_id);
        }}
      >
        <Text style={styles.dismissX}>×</Text>
      </Pressable>
    </Pressable>
  );
}

export default memo(ReturnAnnouncementCard);

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.bgCard,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 12,
  },
  containerSoon: {
    borderColor: theme.accent,
    backgroundColor: 'rgba(255,107,53,0.08)',
  },
  posterWrap: {
    width: 48,
    height: 68,
    borderRadius: 6,
    overflow: 'hidden',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  posterPlaceholder: {
    backgroundColor: theme.bgDarker,
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterPlaceholderText: {
    fontSize: 22,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  kicker: {
    fontSize: 10,
    fontFamily: 'DMSans_700Bold',
    color: theme.accent,
    letterSpacing: 1,
  },
  kickerSoon: {
    fontSize: 11,
  },
  title: {
    fontSize: 16,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  date: {
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
  },
  dismiss: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissX: {
    fontSize: 22,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
    lineHeight: 22,
  },
});
