import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Keyboard, Platform, StyleSheet, type ViewStyle } from 'react-native';

// Drop-in replacement for <KeyboardAvoidingView behavior="padding"> on the
// auth screens. The stock KAV listens to `keyboardWillChangeFrame`, which
// fires every time iOS toggles the QuickType / Passwords accessory bar above
// the keyboard — each toggle re-applies padding and the screen visibly
// jitters while the user is typing in a password field.
//
// We only listen to `keyboardWillShow` / `keyboardWillHide`, so the padding
// is captured once when the keyboard opens and held steady until it closes.
// QuickType bar appearances are ignored. The first measurement includes the
// QuickType bar if iOS chooses to show it on focus, which is the safer
// failure mode (slightly extra padding > content covered).
//
// On Android the JSX-level avoidance is a no-op — Expo's default
// `softwareKeyboardLayoutMode: resize` already shrinks the window region.

interface Props {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
}

export function StableKeyboardView({ children, style }: Props) {
  const pad = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const showSub = Keyboard.addListener('keyboardWillShow', e => {
      Animated.timing(pad, {
        toValue: e.endCoordinates.height,
        duration: e.duration ?? 250,
        useNativeDriver: false,
      }).start();
    });
    const hideSub = Keyboard.addListener('keyboardWillHide', e => {
      Animated.timing(pad, {
        toValue: 0,
        duration: e.duration ?? 250,
        useNativeDriver: false,
      }).start();
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [pad]);

  return (
    <Animated.View style={[styles.fill, style, { paddingBottom: pad }]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
