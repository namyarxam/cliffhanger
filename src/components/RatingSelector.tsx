import { memo, useState, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent } from 'react-native';
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

  const displayRating = tempRating ?? rating;
  const color = displayRating ? getUserRatingColor(displayRating) : theme.textDim;

  function pageXToRating(pageX: number): number {
    const x = pageX - trackPageX.current;
    const clamped = Math.max(0, Math.min(x, trackWidth));
    const raw = 1.0 + (clamped / trackWidth) * 9.0;
    return Math.round(raw * 10) / 10;
  }

  function ratingToX(r: number): number {
    return ((r - 1.0) / 9.0) * trackWidth;
  }

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      setDragging(true);
      onDragStart?.();
      setTempRating(pageXToRating(evt.nativeEvent.pageX));
    },
    onPanResponderMove: (evt) => {
      setTempRating(pageXToRating(evt.nativeEvent.pageX));
    },
    onPanResponderRelease: (evt) => {
      setDragging(false);
      onDragEnd?.();
      const finalRating = pageXToRating(evt.nativeEvent.pageX);
      setTempRating(null);
      onRate(finalRating);
    },
    onPanResponderTerminate: () => {
      setDragging(false);
      onDragEnd?.();
      setTempRating(null);
    },
  });

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
