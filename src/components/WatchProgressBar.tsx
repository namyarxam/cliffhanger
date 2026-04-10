import { memo, useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { theme } from '@/src/lib/theme';

interface Props {
  airedCount: number;
  watchedCount: number;
}

export default memo(function WatchProgressBar({ airedCount, watchedCount }: Props) {
  const fraction = airedCount > 0 ? Math.min(watchedCount / airedCount, 1) : 0;
  const animatedWidth = useRef(new Animated.Value(fraction)).current;

  useEffect(() => {
    Animated.timing(animatedWidth, {
      toValue: fraction,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [fraction, animatedWidth]);

  return (
    <View style={styles.track}>
      <Animated.View
        style={[
          styles.fill,
          {
            width: animatedWidth.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  track: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginTop: 20,
    marginHorizontal: 20,
  },
  fill: {
    height: '100%',
    backgroundColor: theme.accent,
  },
});
