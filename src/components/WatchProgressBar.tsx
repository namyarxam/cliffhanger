import { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { theme } from '@/src/lib/theme';

interface Props {
  airedCount: number;
  watchedCount: number;
}

export default memo(function WatchProgressBar({ airedCount, watchedCount }: Props) {
  const fraction = airedCount > 0 ? Math.min(watchedCount / airedCount, 1) : 0;

  return (
    <View style={styles.track}>
      {fraction > 0 && (
        <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
      )}
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
