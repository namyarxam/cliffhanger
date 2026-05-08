import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Animated, {
  FadeIn,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { useTheme } from '@/src/providers/ThemeProvider';
import { useAuth } from '@/src/providers/AuthProvider';
import type { Theme } from '@/src/lib/theme';

// Three iconic posters fanned behind the headline. URLs are TVMaze public
// CDN — stable for years and free, but the screen still degrades gracefully
// if any single one fails to load (the others carry the visual).
const HERO_POSTERS = [
  // Severance
  { uri: 'https://static.tvmaze.com/uploads/images/medium_portrait/548/1371406.jpg', rotate: -10, x: -88, y: 14 },
  // Breaking Bad
  { uri: 'https://static.tvmaze.com/uploads/images/medium_portrait/501/1253519.jpg', rotate: 0, x: 0, y: 0 },
  // The Last of Us
  { uri: 'https://static.tvmaze.com/uploads/images/medium_portrait/563/1409008.jpg', rotate: 10, x: 88, y: 14 },
];

export default function WelcomeScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { markOnboarded } = useAuth();
  const [skipping, setSkipping] = useState(false);

  // A soft pulse on the accent dot so the screen has a heartbeat without
  // anything moving aggressively. Loops indefinitely while the screen mounts.
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + pulse.value * 0.55,
    transform: [{ scale: 0.9 + pulse.value * 0.25 }],
  }));

  const handleStart = () => {
    router.push('/(onboarding)/first-show');
  };

  const handleSkip = async () => {
    if (skipping) return;
    setSkipping(true);
    await markOnboarded();
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <View style={styles.heroWrap}>
        {HERO_POSTERS.map((p, i) => (
          <View
            key={p.uri}
            style={[
              styles.posterCard,
              {
                transform: [
                  { translateX: p.x },
                  { translateY: p.y },
                  { rotate: `${p.rotate}deg` },
                ],
                zIndex: i === 1 ? 2 : 1,
              },
            ]}
          >
            <Animated.View
              entering={FadeInDown.delay(120 + i * 90).duration(620).springify().damping(18)}
              style={styles.posterFill}
            >
              <Image source={{ uri: p.uri }} style={styles.poster} contentFit="cover" transition={200} />
            </Animated.View>
          </View>
        ))}
      </View>

      <Animated.View entering={FadeIn.delay(520).duration(500)} style={styles.dotRow}>
        <Animated.View style={[styles.dot, pulseStyle]} />
        <Text style={styles.dotLabel}>Welcome to Cliffhanger</Text>
      </Animated.View>

      <Animated.Text entering={FadeInDown.delay(620).duration(560).springify().damping(20)} style={styles.headline}>
        Track shows.{'\n'}Together.
      </Animated.Text>

      <Animated.Text entering={FadeInDown.delay(760).duration(500)} style={styles.body}>
        Track what you watch, discover what your friends love, and talk about it all in one place.
      </Animated.Text>

      <View style={styles.spacer} />

      <Animated.View entering={FadeInDown.delay(900).duration(500)} style={styles.ctaWrap}>
        <Pressable
          style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
          onPress={handleStart}
          disabled={skipping}
        >
          <Text style={styles.primaryText}>Add your first show</Text>
          <Text style={styles.primaryArrow}>→</Text>
        </Pressable>
        <Pressable onPress={handleSkip} hitSlop={12} style={styles.skipBtn} disabled={skipping}>
          {skipping ? (
            <ActivityIndicator color={theme.textDim} size="small" />
          ) : (
            <Text style={styles.skipText}>Skip for now</Text>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const POSTER_W = 110;
const POSTER_H = 154;

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: 28,
    paddingTop: 80,
    paddingBottom: 36,
  },
  heroWrap: {
    height: POSTER_H + 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
  },
  posterCard: {
    position: 'absolute',
    width: POSTER_W,
    height: POSTER_H,
    borderRadius: 10,
    backgroundColor: theme.bgCard,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  posterFill: { width: '100%', height: '100%' },
  poster: { width: '100%', height: '100%' },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    marginBottom: 14,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.accent,
  },
  dotLabel: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 12,
    color: theme.textDim,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  headline: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 30,
    lineHeight: 36,
    color: theme.text,
    textAlign: 'center',
    letterSpacing: -0.6,
  },
  body: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: theme.textDim,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 8,
  },
  spacer: { flex: 1 },
  ctaWrap: { gap: 14 },
  primary: {
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryPressed: { opacity: 0.85 },
  primaryText: {
    color: '#fff',
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 16,
  },
  primaryArrow: {
    color: '#fff',
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 18,
  },
  skipBtn: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    minHeight: 28,
    justifyContent: 'center',
  },
  skipText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: theme.textDim,
  },
});
