import { View, Text, StyleSheet } from 'react-native';
import { getRatingColor } from '@/src/lib/utils';

interface Props {
  rating: number;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: { box: 32, font: 12 },
  md: { box: 40, font: 14 },
  lg: { box: 52, font: 18 },
};

export default function RatingBadge({ rating, size = 'md' }: Props) {
  const color = getRatingColor(rating);
  const s = SIZES[size];

  return (
    <View style={[styles.badge, {
      width: s.box,
      height: s.box,
      borderRadius: s.box * 0.25,
      borderColor: color,
    }]}>
      <Text style={[styles.text, { fontSize: s.font, color }]}>
        {rating.toFixed(1)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  text: {
    fontFamily: 'DMSans_700Bold',
  },
});
