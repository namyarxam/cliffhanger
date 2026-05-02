import type { Theme } from "@/src/lib/theme";
import { useTheme } from "@/src/providers/ThemeProvider";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

// TV-flavored flavor text. Cycles every ~2.5s while a loader is up.
// Random starting index so two consecutive loads don't open with
// the same line. Kept playful but not cute-to-the-point-of-distracting —
// the spinner is the real signal; this is just so multi-second loads
// don't feel like a hang.
//
// Auth/cold-launch messages — broad "starting up" feel.
export const AUTH_MESSAGES = [
  "Tuning in…",
  "Pressing play…",
  "Cueing the theme song…",
  "Skipping the intro…",
  "Polling the writers’ room…",
  "Adjusting the rabbit ears…",
  "Refilling the popcorn…",
  "Catching up on the gossip…",
  "Fluffing the couch cushions…",
  "Asking your friends what’s good…",
  "Loading your watchlist…",
  "Searching the archives…",
  "Negotiating with the network…",
  "Restocking the snack drawer…",
  "Spoiler-free zone…",
];

// My Shows initial-fetch messages — more "compiling your shelf" feel.
export const SHELF_MESSAGES = [
  "Fetching your shows…",
  "Looking up airdates…",
  "Counting episodes…",
  "Stacking the queue…",
  "Sorting your shelf…",
  "Checking what’s new…",
  "Pulling tonight’s lineup…",
  "Checking the schedule…",
  "Sweeping for new episodes…",
  "Lining up the posters…",
  "Filing the spoilers away…",
  "Compiling your watchlist…",
];

interface Props {
  messages?: string[];
}

export default function LoaderFlavor({ messages = AUTH_MESSAGES }: Props) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * messages.length),
  );
  // Hold the text for a beat so the spinner appears alone on snappy
  // launches — flashing flavor text for 100ms feels worse than no text.
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    const reveal = setTimeout(() => setShowText(true), 500);
    const tick = setInterval(() => {
      setIndex((prev) => (prev + 1) % messages.length);
    }, 2500);
    return () => {
      clearTimeout(reveal);
      clearInterval(tick);
    };
  }, [messages.length]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={theme.accent} size="large" />
      <Text style={[styles.text, !showText && styles.textHidden]}>
        {messages[index]}
      </Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      gap: 16,
      backgroundColor: theme.bg,
    },
    text: {
      fontSize: 13,
      fontFamily: "DMSans_500Medium",
      color: theme.textDim,
    },
    textHidden: {
      opacity: 0,
    },
  });
