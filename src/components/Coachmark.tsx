import { useEffect, useMemo } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
  FadeIn,
  FadeInUp,
  FadeOut,
} from 'react-native-reanimated';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';
import type { CoachmarkGesture } from '@/src/providers/TutorialProvider';

interface TargetRect { x: number; y: number; w: number; h: number; }

interface Props {
  target: TargetRect;
  gesture: CoachmarkGesture;
  title: string;
  body?: string;
  // Optional override for the cutout ring + gesture hint color. Falls back
  // to theme.accent. Use this when the highlighted element is itself accent-
  // colored so the indicators read against it.
  highlightColor?: string;
  onDismiss: () => void;
}

// Padding around the highlighted element. Gives the cutout breathing room
// so the user's eye lands on the element + its immediate context.
const CUTOUT_PAD = 10;
// Compact tooltip width — Slack/Notion-style card pointing at the target,
// not a full-width banner.
const TOOLTIP_WIDTH = 280;
// Minimum padding from screen edges when the cutout is near the side.
const SCREEN_GUTTER = 16;
// Visible distance between cutout and tooltip (excludes the arrow itself).
const TOOLTIP_GAP = 14;
// Arrow triangle dimensions. Equilateral-ish — wider than tall reads better.
const ARROW_W = 16;
const ARROW_H = 9;

export default function Coachmark({ target, gesture, title, body, highlightColor, onDismiss }: Props) {
  const theme = useTheme();
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const accent = highlightColor ?? theme.accent;
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Cutout rect with padding. Clamped so we don't render negative geometry
  // when the target is at the very edge of the screen.
  const cutout = useMemo(() => ({
    x: Math.max(0, target.x - CUTOUT_PAD),
    y: Math.max(0, target.y - CUTOUT_PAD),
    w: Math.min(screenW, target.w + CUTOUT_PAD * 2),
    h: Math.min(screenH, target.h + CUTOUT_PAD * 2),
  }), [target, screenW, screenH]);

  // Place the tooltip below the cutout if there's room, otherwise above.
  // We assume a generous tooltip height budget (~140) when deciding.
  const tooltipBelow = cutout.y + cutout.h + TOOLTIP_GAP + ARROW_H + 140 < screenH - 60;
  const tooltipTop = tooltipBelow
    ? cutout.y + cutout.h + TOOLTIP_GAP + ARROW_H
    : undefined;
  const tooltipBottom = tooltipBelow
    ? undefined
    : screenH - cutout.y + TOOLTIP_GAP + ARROW_H;

  // Horizontal alignment: center the tooltip on the cutout, then clamp to
  // a 16px gutter on either side so it doesn't bleed off-screen when the
  // target sits near the left/right edge.
  const targetCenterX = cutout.x + cutout.w / 2;
  const tooltipLeftIdeal = targetCenterX - TOOLTIP_WIDTH / 2;
  const tooltipLeft = Math.max(
    SCREEN_GUTTER,
    Math.min(tooltipLeftIdeal, screenW - TOOLTIP_WIDTH - SCREEN_GUTTER),
  );
  // Arrow centered on the target, expressed relative to the tooltip's
  // left edge. Clamped to stay visually inside the card with a small
  // corner inset so it doesn't merge with the tooltip's rounded corner.
  const arrowLeftIdeal = targetCenterX - tooltipLeft - ARROW_W / 2;
  const arrowLeft = Math.max(
    14,
    Math.min(arrowLeftIdeal, TOOLTIP_WIDTH - ARROW_W - 14),
  );

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(180)}
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
    >
      {/* Four dim rectangles around the cutout = "hole" without needing a mask layer.
          Each is also a Pressable so tapping anywhere outside the highlight dismisses. */}
      <Pressable onPress={onDismiss} style={[styles.scrim, {
        left: 0, top: 0, right: 0, height: cutout.y,
      }]} />
      <Pressable onPress={onDismiss} style={[styles.scrim, {
        left: 0, top: cutout.y + cutout.h, right: 0, bottom: 0,
      }]} />
      <Pressable onPress={onDismiss} style={[styles.scrim, {
        left: 0, top: cutout.y, width: cutout.x, height: cutout.h,
      }]} />
      <Pressable onPress={onDismiss} style={[styles.scrim, {
        left: cutout.x + cutout.w, top: cutout.y, right: 0, height: cutout.h,
      }]} />

      {/* Subtle ring around the cutout — picks the eye out of the dim. */}
      <View
        pointerEvents="none"
        style={[styles.cutoutRing, {
          left: cutout.x,
          top: cutout.y,
          width: cutout.w,
          height: cutout.h,
          borderColor: accent,
        }]}
      />

      <GestureHint gesture={gesture} cutout={cutout} theme={theme} accent={accent} />

      <Animated.View
        entering={FadeInUp.delay(120).duration(280).easing(Easing.out(Easing.cubic))}
        style={[styles.tooltip, {
          top: tooltipTop,
          bottom: tooltipBottom,
          left: tooltipLeft,
          width: TOOLTIP_WIDTH,
        }]}
      >
        {/* Arrow points from the tooltip toward the cutout. The tooltip's
            border radius hides any corner overlap. */}
        <View
          pointerEvents="none"
          style={[
            styles.arrow,
            tooltipBelow ? { top: -ARROW_H } : { bottom: -ARROW_H },
            { left: arrowLeft },
            tooltipBelow ? styles.arrowDown : styles.arrowUp,
          ]}
        />
        <Text style={styles.tooltipTitle}>{title}</Text>
        {body ? <Text style={styles.tooltipBody}>{body}</Text> : null}
        <Pressable onPress={onDismiss} style={styles.gotIt} hitSlop={8}>
          <Text style={styles.gotItText}>Got it</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

// ─── Gesture animation atoms ───────────────────────────────────────────────

interface GestureHintProps {
  gesture: CoachmarkGesture;
  cutout: TargetRect;
  theme: Theme;
  accent: string;
}

// Each branch is wrapped in an Animated.View with entering+exiting so swapping
// gestures (e.g. tap → longpress on a chain handoff) cross-fades smoothly.
// The conditional inside Reanimated's reconciliation triggers the exit on the
// outgoing branch and the enter on the incoming one, with both running
// concurrently for ~150ms — no flash of empty cutout in between.
function GestureHint({ gesture, cutout, theme, accent }: GestureHintProps) {
  return (
    <>
      {gesture === 'tap' && (
        <Animated.View key="tap" entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill} pointerEvents="none">
          <TapHint cutout={cutout} accent={accent} />
        </Animated.View>
      )}
      {gesture === 'longpress' && (
        <Animated.View key="longpress" entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill} pointerEvents="none">
          <LongPressHint cutout={cutout} accent={accent} />
        </Animated.View>
      )}
      {gesture === 'drag-horizontal' && (
        <Animated.View key="drag-h" entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill} pointerEvents="none">
          <DragHint cutout={cutout} theme={theme} horizontal />
        </Animated.View>
      )}
      {gesture === 'drag-vertical' && (
        <Animated.View key="drag-v" entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill} pointerEvents="none">
          <DragHint cutout={cutout} theme={theme} horizontal={false} />
        </Animated.View>
      )}
    </>
  );
}

// Pulsing dot at the cutout center. Quick, friendly — "tap here".
function TapHint({ cutout, accent }: { cutout: TargetRect; accent: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 0 }),
        withDelay(200, withTiming(0, { duration: 0 })),
      ),
      -1,
    );
  }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.85 - t.value * 0.85,
    transform: [{ scale: 0.5 + t.value * 1.1 }],
  }));
  const dotSize = 28;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: cutout.x + cutout.w / 2 - dotSize / 2,
          top: cutout.y + cutout.h / 2 - dotSize / 2,
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: accent,
        },
        style,
      ]}
    />
  );
}

// Concentric pressure ring — slower, suggests holding. Pairs with body copy
// like "Hold to mute" so the gesture is unambiguous.
function LongPressHint({ cutout, accent }: { cutout: TargetRect; accent: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) }),
      -1,
    );
  }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.85 - t.value * 0.85,
    transform: [{ scale: 0.4 + t.value * 1.2 }],
  }));
  const size = Math.min(cutout.w, cutout.h) * 0.55;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: cutout.x + cutout.w / 2 - size / 2,
          top: cutout.y + cutout.h / 2 - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 4,
          borderColor: accent,
        },
        style,
      ]}
    />
  );
}

// Sliding arrow inside the cutout — direction depends on horizontal flag.
function DragHint({ cutout, theme, horizontal }: { cutout: TargetRect; theme: Theme; horizontal: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.cubic) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.cubic) }),
      ),
      -1,
    );
  }, [t]);
  const travel = (horizontal ? cutout.w : cutout.h) * 0.4;
  const style = useAnimatedStyle(() => {
    const offset = (t.value - 0.5) * 2 * travel;
    return {
      transform: horizontal ? [{ translateX: offset }] : [{ translateY: offset }],
      opacity: 0.55 + Math.sin(t.value * Math.PI) * 0.45,
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: cutout.x + cutout.w / 2 - 14,
          top: cutout.y + cutout.h / 2 - 14,
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: theme.accent,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text style={{ color: '#fff', fontFamily: 'DMSans_700Bold', fontSize: 16 }}>
        {horizontal ? '↔' : '↕'}
      </Text>
    </Animated.View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  scrim: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  cutoutRing: {
    position: 'absolute',
    borderRadius: 12,
    borderWidth: 2,
    // borderColor applied inline so it can vary per-coachmark via `accent`.
  },
  tooltip: {
    position: 'absolute',
    backgroundColor: theme.bgCard,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  arrow: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: ARROW_W / 2,
    borderRightWidth: ARROW_W / 2,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  // Tooltip is BELOW the cutout — arrow points UP toward the cutout, so
  // the colored side is the bottom half of the triangle (renders on top
  // of the tooltip's top edge).
  arrowDown: {
    borderBottomWidth: ARROW_H,
    borderBottomColor: theme.bgCard,
    borderTopWidth: 0,
  },
  arrowUp: {
    borderTopWidth: ARROW_H,
    borderTopColor: theme.bgCard,
    borderBottomWidth: 0,
  },
  tooltipTitle: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 16,
    color: theme.text,
    marginBottom: 6,
  },
  tooltipBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: theme.textDim,
  },
  gotIt: {
    alignSelf: 'flex-end',
    paddingTop: 12,
    paddingHorizontal: 4,
  },
  gotItText: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 14,
    color: theme.accent,
  },
});
