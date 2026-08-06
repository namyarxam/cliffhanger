import { memo, useState, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';

// Green-based color scale for the dark theme
// 10 = vibrant green, down through teal, blue, purple, to muted red-grey
export function getUserRatingColor(rating: number): string {
  if (rating >= 9.5) return '#4ade80'; // bright green
  if (rating >= 9.0) return '#34d399'; // green
  if (rating >= 8.5) return '#2dd4bf'; // teal-green
  if (rating >= 8.0) return '#22d3ee'; // cyan
  if (rating >= 7.5) return '#38bdf8'; // sky blue
  if (rating >= 7.0) return '#60a5fa'; // blue
  if (rating >= 6.5) return '#818cf8'; // indigo
  if (rating >= 6.0) return '#93a0f8'; // soft indigo
  if (rating >= 5.5) return '#a8a0d0'; // muted lavender
  if (rating >= 5.0) return '#c4a07a'; // warm tan
  if (rating >= 4.5) return '#d4946a'; // burnt orange
  if (rating >= 4.0) return '#e0805a'; // orange-red
  if (rating >= 3.0) return '#f87171'; // red
  if (rating >= 2.0) return '#a8a29e'; // warm grey
  return '#78716c'; // muted grey
}

interface Props {
  rating: number | null;
  onRate: (rating: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

function RatingSelector({ rating, onRate, onDragStart, onDragEnd }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [tempRating, setTempRating] = useState<number | null>(null);
  const trackPageX = useRef(0);

  // The pan responder is created ONCE (see the useRef below) and lives for
  // the component's whole life, so everything it reads has to come through
  // refs — props and state captured in its closures are frozen at mount.
  // Recreating it per render is the classic PanResponder bug: a re-render
  // mid-drag (which setTempRating guarantees) swaps in a fresh responder
  // whose internal gestureState restarts, and any math built on it glitches.
  const trackWidthRef = useRef(0);
  trackWidthRef.current = trackWidth;
  const ratingRef = useRef(rating);
  ratingRef.current = rating;
  const callbacksRef = useRef({ onRate, onDragStart, onDragEnd });
  callbacksRef.current = { onRate, onDragStart, onDragEnd };

  const displayRating = tempRating ?? rating;
  const color = displayRating ? getUserRatingColor(displayRating) : theme.textDim;

  function pageXToRaw(pageX: number): number {
    const w = trackWidthRef.current;
    const x = pageX - trackPageX.current;
    const clamped = Math.max(0, Math.min(x, w));
    return 1.0 + (clamped / w) * 9.0;
  }

  function ratingToX(r: number): number {
    return ((r - 1.0) / 9.0) * trackWidthRef.current;
  }

  /**
   * Speed-adaptive scrubbing — the slider's position tracks accumulated
   * finger *movement*, not finger *position*, and each movement's gain
   * scales with its speed (the same idea as pointer acceleration, or the
   * iOS scrubber's precision mode).
   *
   * Why: the track maps ~350pt onto 90 steps of 0.1, under 4pt per step —
   * beneath finger accuracy, so an absolute mapping made tenths nearly
   * unselectable. With gain, a flick still sweeps the whole range, while a
   * slow deliberate drag runs at FINE_GAIN, where one 0.1 step costs ~25pt
   * of travel.
   *
   * The integer magnet only engages at speed. When fine-tuning it is off —
   * at the old always-on ±0.10 radius, x.9 and x.1 snapped to the integer
   * and were literally impossible to select.
   */
  const FINE_GAIN = 0.15; // floor; slow drags run here
  const FULL_SPEED = 0.5; // finger speed (pt/ms) at which gain reaches 1
  const dragValue = useRef(0); // unrounded 1..10 accumulator during a drag
  const lastPageX = useRef(0); // deltas and speed come from raw positions —
  const lastMoveTime = useRef(0); // never from gestureState's bookkeeping
  const gainAvg = useRef(1); // smoothed so gain doesn't flutter per-event
  const lastTicked = useRef<number | null>(null); // last haptic'd display value

  function displayed(raw: number, gain: number): number {
    const nearestInt = Math.round(raw);
    if (gain > 0.5 && Math.abs(raw - nearestInt) <= 0.1) return nearestInt;
    return Math.round(raw * 10) / 10;
  }

  function tick(value: number) {
    if (value === lastTicked.current) return;
    const wasInteger = value === Math.round(value);
    // Integers always click. Tenths only click in fine mode — a full-range
    // flick crosses ninety of them, which reads as buzz, not detents.
    if (wasInteger) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else if (gainAvg.current <= 0.5) void Haptics.selectionAsync();
    lastTicked.current = value;
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        setDragging(true);
        callbacksRef.current.onDragStart?.();
        const { pageX, timestamp } = evt.nativeEvent;
        const current = ratingRef.current;
        // Touching at/near the thumb picks it up in place, so a fine-tune
        // starts from the exact current value instead of wherever the finger
        // landed. Touching elsewhere jumps, keeping tap-to-set.
        const grabbed =
          current != null && Math.abs(pageX - trackPageX.current - ratingToX(current)) < 28;
        dragValue.current = grabbed ? current : pageXToRaw(pageX);
        lastPageX.current = pageX;
        lastMoveTime.current = timestamp;
        gainAvg.current = 1;
        lastTicked.current = null;
        setTempRating(displayed(dragValue.current, 1));
      },
      onPanResponderMove: (evt) => {
        const { pageX, timestamp } = evt.nativeEvent;
        const delta = pageX - lastPageX.current;
        const dt = timestamp - lastMoveTime.current;
        lastPageX.current = pageX;
        lastMoveTime.current = timestamp;
        if (dt <= 0) return;
        const speed = Math.abs(delta) / dt; // pt/ms, platform-independent
        const target = Math.min(1, speed / FULL_SPEED);
        gainAvg.current = gainAvg.current * 0.7 + target * 0.3;
        const gain = Math.max(FINE_GAIN, gainAvg.current);
        const next = dragValue.current + (delta / trackWidthRef.current) * 9.0 * gain;
        dragValue.current = Math.max(1, Math.min(10, next));
        const shown = displayed(dragValue.current, gain);
        tick(shown);
        setTempRating(shown);
      },
      onPanResponderRelease: () => {
        setDragging(false);
        callbacksRef.current.onDragEnd?.();
        const finalRating = displayed(dragValue.current, gainAvg.current);
        setTempRating(null);
        callbacksRef.current.onRate(finalRating);
      },
      onPanResponderTerminate: () => {
        setDragging(false);
        callbacksRef.current.onDragEnd?.();
        setTempRating(null);
      },
    }),
  ).current;

  const trackRef = useRef<View>(null);

  const handleLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
    trackRef.current?.measureInWindow((x) => {
      trackPageX.current = x;
    });
  };

  const hasRating = displayRating != null;
  const fillWidth = hasRating && trackWidth > 0
    ? ratingToX(displayRating)
    : 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>Your Rating</Text>
        <Text style={[styles.ratingValue, { color: hasRating ? color : 'transparent' }]}>
          {hasRating ? displayRating.toFixed(1) : '0.0'}
        </Text>
      </View>

      {/* Slider track */}
      <View
        ref={trackRef}
        style={styles.trackOuter}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
      >
        <View style={styles.track}>
          {/* Fill */}
          <View
            style={[
              styles.trackFill,
              {
                width: fillWidth,
                backgroundColor: color,
              },
            ]}
          />
        </View>

        {/* Integer tick marks. Render outside the track-fill clipping
            container so they sit on top of both filled and empty regions.
            10 ticks at 1.0, 2.0, ..., 10.0 — give users a visible anchor
            for the magnetic snap zones. */}
        {trackWidth > 0 && Array.from({ length: 10 }, (_, i) => {
          const r = i + 1;
          const left = ratingToX(r);
          return (
            <View
              key={r}
              pointerEvents="none"
              style={[
                styles.tick,
                { left: left - 1 },
              ]}
            />
          );
        })}

        {/* Thumb */}
        {trackWidth > 0 && (
          <View
            style={[
              styles.thumb,
              hasRating
                ? {
                    left: fillWidth - 10,
                    backgroundColor: color,
                    borderColor: theme.textBright,
                    transform: [{ scale: dragging ? 1.2 : 1 }],
                  }
                : {
                    left: -10,
                    backgroundColor: theme.bgCard,
                    borderColor: theme.textDim,
                  },
            ]}
          />
        )}
      </View>

      {/* Scale labels */}
      <View style={styles.scaleLabels}>
        <Text style={styles.scaleText}>1</Text>
        <Text style={styles.scaleText}>5</Text>
        <Text style={styles.scaleText}>10</Text>
      </View>
    </View>
  );
}

export default memo(RatingSelector);

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontFamily: 'DMSans_700Bold',
    color: theme.text,
  },
  ratingValue: {
    fontSize: 24,
    fontFamily: 'DMSans_700Bold',
  },
  trackOuter: {
    height: 40,
    justifyContent: 'center',
  },
  track: {
    height: 6,
    backgroundColor: theme.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.textBright,
  },
  tick: {
    position: 'absolute',
    top: '50%',
    marginTop: -5,
    width: 2,
    height: 10,
    borderRadius: 1,
    backgroundColor: theme.textFaint,
  },
  scaleLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  scaleText: {
    fontSize: 11,
    fontFamily: 'DMSans_400Regular',
    color: theme.textFaint,
  },
});
