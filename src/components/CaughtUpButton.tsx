import { memo } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { theme } from '@/src/lib/theme';

interface Props {
  onCatchUp: () => void;
  isCaughtUp: boolean;
}

export default memo(function CaughtUpButton({ onCatchUp, isCaughtUp }: Props) {
  if (isCaughtUp) {
    return (
      <Pressable style={[styles.button, styles.buttonDone]} disabled>
        <Text style={styles.textDone}>All caught up</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.button, styles.buttonActive, pressed && { opacity: 0.7 }]}
      onPress={onCatchUp}
    >
      <Text style={styles.textActive}>Catch Up</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: {
    marginTop: 12,
    marginHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonActive: {
    backgroundColor: theme.accent,
  },
  buttonDone: {
    backgroundColor: theme.bgCard,
    borderWidth: 1,
    borderColor: theme.border,
  },
  textActive: {
    fontSize: 14,
    fontFamily: 'DMSans_600SemiBold',
    color: theme.textBright,
  },
  textDone: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: theme.textDim,
  },
});
