import { memo, useMemo, useRef, useCallback, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Animated, Easing } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/providers/ThemeProvider';
import type { Theme } from '@/src/lib/theme';

export interface FeaturedItem {
  show_id: string;
  show_title: string | null;
  show_image: string | null;
}

interface Props {
  items: FeaturedItem[];
  onPress: (showId: string) => void;
  onMute: (showId: string) => void;
  /**
   * Render N skeleton placeholders while data is loading and items is empty.
   * Once items arrive, skeletons disappear in the natural cache update.
   */
  loading?: boolean;
  skeletonCount?: number;
  /**
   * Bump to force the rail back to its initial position. Used by Explore
   * to snap all carousels to the start each time the tab gains focus, so
   * users don't return to a 4000px-deep scroll position from earlier.
   */
  resetSignal?: number;
  /**
   * 'loop' (default): items render 3x with snap-back at copy boundaries —
   *                   true infinite scroll over a fixed-size set.
   * 'extend': items render once; when the user nears the right edge,
   *           onEndReached fires so the parent can append more items
   *           (used by Top Rated, which has a 90-show pool we reveal in
   *           pages of 15 instead of looping the same 15 forever).
   */
  mode?: 'loop' | 'extend';
  onEndReached?: () => void;
}

const SKELETON_DEFAULT = 8;
// Card width + gap. Used to size the looping copy so we can snap-reset
// scroll position when the user crosses a copy boundary. Keep in sync
// with the styles below.
const CARD_WIDTH = 92;
const CARD_GAP = 12;
const ITEM_STRIDE = CARD_WIDTH + CARD_GAP;

// Distance the card travels off-screen during the dismiss animation.
const DISMISS_DISTANCE = 220;
// Long-press delay. Standard iOS feels intentional without being annoying.
const LONG_PRESS_MS = 450;

function FeaturedCarousel({ items, onPress, onMute, loading = false, skeletonCount = SKELETON_DEFAULT, resetSignal, mode = 'loop', onEndReached }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Skeleton state: render placeholder cards while we're waiting for data.
  if (loading && items.length === 0) {
    return (
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <View key={i} style={[styles.card, styles.skeleton]} />
          ))}
        </ScrollView>
        <LinearGradient
          pointerEvents="none"
          colors={[`${theme.bg}00`, theme.bg]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.edgeFade}
        />
      </View>
    );
  }

  if (items.length === 0) return null;

  if (mode === 'extend') {
    return (
      <ExtendingRail
        items={items}
        styles={styles}
        bgColor={theme.bg}
        onPress={onPress}
        onMute={onMute}
        resetSignal={resetSignal}
        onEndReached={onEndReached}
      />
    );
  }

  return (
    <LoopingRail
      items={items}
      styles={styles}
      bgColor={theme.bg}
      onPress={onPress}
      onMute={onMute}
      resetSignal={resetSignal}
    />
  );
}

interface LoopingRailProps {
  items: FeaturedItem[];
  styles: ReturnType<typeof createStyles>;
  bgColor: string;
  onPress: (showId: string) => void;
  onMute: (showId: string) => void;
  resetSignal?: number;
}

/**
 * True infinite-loop carousel. Renders items 3x, starts the user in the
 * middle copy, and silently resets scroll position back into the middle
 * when they cross into the leading or trailing copy. The wrap is
 * imperceptible because the scroll offset jumps to the visually-identical
 * position one copy width away.
 */
function LoopingRail({ items, styles, bgColor, onPress, onMute, resetSignal }: LoopingRailProps) {
  const scrollRef = useRef<ScrollView>(null);
  const initialized = useRef(false);
  const lastResetSignal = useRef(resetSignal);
  const copyWidth = items.length * ITEM_STRIDE;
  const looped = useMemo(() => [...items, ...items, ...items], [items]);

  // Start in the middle copy on initial mount only. Without this, scrolling
  // left from index 0 would hit a hard edge before the wrap detector could
  // fire. Skipping subsequent runs keeps the user's reading position stable
  // when items.length changes (e.g. after a mute removes a card).
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: copyWidth, animated: false });
    });
  }, [copyWidth]);

  // Snap back to the start when the parent bumps resetSignal (e.g. on tab
  // re-focus). Compared against a ref so the effect only fires on actual
  // changes — not on the initial mount, which is already handled above.
  useEffect(() => {
    if (resetSignal === lastResetSignal.current) return;
    lastResetSignal.current = resetSignal;
    scrollRef.current?.scrollTo({ x: copyWidth, animated: false });
  }, [resetSignal, copyWidth]);

  const handleMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    // Crossed past the trailing edge of the middle copy → jump back one
    // copy width. Likewise for the leading edge.
    if (x >= copyWidth * 2) {
      scrollRef.current?.scrollTo({ x: x - copyWidth, animated: false });
    } else if (x < copyWidth) {
      scrollRef.current?.scrollTo({ x: x + copyWidth, animated: false });
    }
  }, [copyWidth]);

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        onMomentumScrollEnd={handleMomentumEnd}
        // Disable the iOS "bounce" past the edge — the wrap detector
        // expects discrete momentum-end events at predictable offsets.
        bounces={false}
      >
        {looped.map((item, idx) => (
          <CarouselCard
            key={`${item.show_id}-${idx}`}
            item={item}
            styles={styles}
            onPress={onPress}
            onMute={onMute}
          />
        ))}
      </ScrollView>
      <LinearGradient
        pointerEvents="none"
        colors={[`${bgColor}00`, bgColor]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.edgeFade}
      />
    </View>
  );
}

interface ExtendingRailProps {
  items: FeaturedItem[];
  styles: ReturnType<typeof createStyles>;
  bgColor: string;
  onPress: (showId: string) => void;
  onMute: (showId: string) => void;
  resetSignal?: number;
  onEndReached?: () => void;
}

// Distance from the right edge (in px) at which we trigger the parent's
// "load more" hook. Roughly two cards wide so the next page is staged
// before the user sees empty space.
const END_REACH_THRESHOLD = 200;

/**
 * Finite, paginating rail. Used by Top Rated to reveal the 90-show pool
 * 15 at a time as the user scrolls right. Once the parent stops feeding
 * new items (pool exhausted), the user just hits the natural right edge.
 * Reset behavior is identical to LoopingRail — bumping resetSignal snaps
 * back to scrollX = 0.
 */
function ExtendingRail({ items, styles, bgColor, onPress, onMute, resetSignal, onEndReached }: ExtendingRailProps) {
  const scrollRef = useRef<ScrollView>(null);
  const lastResetSignal = useRef(resetSignal);
  // Latches once the user crosses into the "near end" zone so onEndReached
  // fires once per zone-entry, not on every scroll event. Cleared when
  // they scroll back out, allowing re-trigger on the next approach (e.g.
  // after the parent appended more items, the right edge moves further
  // out and the user re-enters the zone).
  const reachedEnd = useRef(false);

  useEffect(() => {
    if (resetSignal === lastResetSignal.current) return;
    lastResetSignal.current = resetSignal;
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [resetSignal]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromEnd = contentSize.width - (contentOffset.x + layoutMeasurement.width);
    if (distanceFromEnd < END_REACH_THRESHOLD) {
      if (!reachedEnd.current) {
        reachedEnd.current = true;
        onEndReached?.();
      }
    } else {
      reachedEnd.current = false;
    }
  }, [onEndReached]);

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={200}
      >
        {items.map((item, idx) => (
          <CarouselCard
            key={`${item.show_id}-${idx}`}
            item={item}
            styles={styles}
            onPress={onPress}
            onMute={onMute}
          />
        ))}
      </ScrollView>
      <LinearGradient
        pointerEvents="none"
        colors={[`${bgColor}00`, bgColor]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.edgeFade}
      />
    </View>
  );
}

interface CardProps {
  item: FeaturedItem;
  styles: ReturnType<typeof createStyles>;
  onPress: (showId: string) => void;
  onMute: (showId: string) => void;
}

function CarouselCard({ item, styles, onPress, onMute }: CardProps) {
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const dismissed = useRef(false);

  const commitDismiss = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -DISMISS_DISTANCE,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 0.85,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      onMute(item.show_id);
    });
  }, [item.show_id, onMute, translateY, opacity, scale]);

  return (
    <Animated.View
      style={[
        styles.card,
        { transform: [{ translateY }, { scale }], opacity },
      ]}
    >
      <Pressable
        style={({ pressed }) => pressed && { opacity: 0.7 }}
        onPress={() => onPress(item.show_id)}
        onLongPress={commitDismiss}
        delayLongPress={LONG_PRESS_MS}
      >
        {item.show_image ? (
          <Image source={{ uri: item.show_image }} style={styles.poster} contentFit="cover" transition={200} />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]}>
            <Text style={styles.placeholderText}>📺</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export default memo(FeaturedCarousel);

const createStyles = (theme: Theme) => StyleSheet.create({
  scrollContent: {
    // Left pad matches the inter-card gap (12) so the looping rail can land
    // at scrollX = copyWidth with the previous copy's trailing card flush
    // off-screen. With a 16px left pad the math is off by 4px and a sliver
    // of the previous poster peeks through, hinting at off-screen content
    // and breaking the "natural first poster" feel.
    paddingLeft: 12,
    paddingRight: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 12,
  },
  card: {
    width: 92,
  },
  poster: {
    width: 92,
    height: 131,
    borderRadius: 6,
  },
  posterPlaceholder: {
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  placeholderText: {
    fontSize: 28,
  },
  // Skeleton placeholder. Same dimensions as a real poster so layout
  // doesn't jump when data swaps in. Solid theme.bgCard rather than a
  // shimmer animation — cheaper and consistent with the rest of the app.
  skeleton: {
    width: 92,
    height: 131,
    borderRadius: 6,
    backgroundColor: theme.bgCard,
  },
  edgeFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 48,
  },
});
