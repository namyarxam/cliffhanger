// The recap story experience.
//
// Full-bleed, tap-through, four acts. This screen deliberately breaks the app's
// normal design language: no cards, no theme background, minimal chrome. It is
// photography with copy laid over it, and it is always dark — even under the
// Paper (light) theme — because the frames are edge-to-edge stills and light
// chrome over them would be unreadable. Theme accent is still honoured for the
// progress bar so it doesn't feel disowned from the rest of the app.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '@/src/providers/ThemeProvider';
import { getRecapMeta, buildFrames } from '@/src/recap/registry';
import { ACT_ORDER, ACT_LABELS } from '@/src/recap/types';
import type { RecapFrame } from '@/src/recap/types';

const KEN_BURNS_MS = 9000;

export default function RecapStoryScreen() {
  const { id, from, through } = useLocalSearchParams<{
    id: string;
    from?: string;
    through?: string;
  }>();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const meta = useMemo(() => getRecapMeta(String(id)), [id]);

  // Range comes from the chip the user tapped. Defaults span everything we
  // hold; buildFrames clamps, so a hand-edited deep link can't reach past the
  // spoiler boundary.
  const frames = useMemo(() => {
    if (!meta) return [];
    const lo = Number(from) || meta.availableSeasons[0];
    const hi = Number(through) || meta.availableSeasons[meta.availableSeasons.length - 1];
    return buildFrames(String(id), { from: lo, through: hi });
  }, [id, meta, from, through]);

  const [index, setIndex] = useState(0);

  // Reset to the first frame whenever the recap changes.
  //
  // Every recap is the same route with different search params
  // (/recap/silo?from=1 vs ?from=2), so React Navigation reuses this screen's
  // instance and useState(0) does NOT re-run. Finishing S1 on frame 15 and then
  // opening S2 dropped you on S2's frame 15 — its cliffhanger — instead of the
  // start.
  //
  // Done during render rather than in an effect: an effect would paint one
  // frame at the stale index first, which is visible as a flash of the wrong
  // slide. This is React's documented pattern for adjusting state when props
  // change, and it re-renders before committing anything to the screen.
  const [framesKey, setFramesKey] = useState(frames);
  if (framesKey !== frames) {
    setFramesKey(frames);
    setIndex(0);
  }

  // Clamped defensively: if a recap ever renders with a shorter frame list
  // before the reset lands, this shows the last valid frame rather than
  // dropping into the "Recap unavailable" branch.
  const frame = frames[Math.min(index, Math.max(0, frames.length - 1))];

  // How many consecutive frames share this image.
  //
  // Some images legitimately repeat — a finale's still pool can be smaller than
  // the number of beats anchored to it. When that happens the pan should read
  // as ONE continuous camera move under changing captions, not restart from the
  // same position on every tap. Measuring the whole run (backwards and forwards
  // from here) lets the pan be scheduled across its full length, so re-entering
  // it mid-run doesn't reset it.
  const runLength = useMemo(() => {
    if (!frame) return 1;
    let start = index;
    while (start > 0 && frames[start - 1]?.image === frame.image) start--;
    let end = index;
    while (end + 1 < frames.length && frames[end + 1]?.image === frame.image) end++;
    return end - start + 1;
  }, [frames, index, frame]);

  // Warm the whole recap into expo-image's cache on mount.
  //
  // Assets are fetched at `original` (~600KB per still) so they don't pixelate
  // when blown up to cover the screen. Without preloading, each frame's image
  // only starts downloading when you land on it — the copy renders instantly
  // and the picture arrives a beat later. A recap is only ~16-23 images, and
  // you spend seconds per frame, so fetching them all up front comfortably
  // outruns the reader.
  //
  // Ordered from the current position outward so the next frames win the
  // bandwidth, rather than the whole set competing at once.
  useEffect(() => {
    if (frames.length === 0) return;
    const ordered = [
      ...frames.slice(index).map(f => f.image),
      ...frames.slice(0, index).map(f => f.image),
    ];
    // Deduped — character frames and the cliffhanger reuse images, and
    // prefetching the same URL repeatedly just wastes requests.
    Image.prefetch([...new Set(ordered)], { cachePolicy: 'memory-disk' }).catch(() => {});
    // Intentionally keyed on `frames` only. Re-prioritising on every tap would
    // restart the sweep constantly; one pass at mount is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames]);

  const exit = useCallback(() => {
    // Always route explicitly to the recap list rather than calling back().
    // This screen lives inside the tab navigator, so the history stack behind
    // it is the tab stack — back() popped out to whichever tab was showing
    // before (usually My Shows), which is not where closing a recap should
    // land you. replace() also means the finished story isn't left behind to
    // reappear on a subsequent back gesture.
    router.replace('/recap');
  }, [router]);

  // Navigation must NOT happen inside a setState updater — React runs updaters
  // during the render phase, so calling router there triggers "Cannot update a
  // component (NavigationContainerInner) while rendering a different
  // component". Compute the next index from the current one and branch out
  // here, in the event handler, where navigating is safe.
  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0) return;
      if (next >= frames.length) {
        exit();
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setIndex(next);
    },
    [index, frames.length, exit],
  );

  if (!meta || !frame) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>Recap unavailable.</Text>
        <Pressable onPress={exit} hitSlop={12}>
          <Text style={[styles.missingLink, { color: theme.accent }]}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      <KenBurns
        uri={frame.image}
        frameKey={index}
        runLength={runLength}
        width={width}
        height={height}
      />

      {/* Per-frame dim. The lever for image/copy mismatch: frames whose picture
          really depicts their words stay bright; frames where the image is only
          atmosphere get pushed back so it reads as texture rather than as a
          scene that disagrees with the text. */}
      {frame.dim ? (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${frame.dim})` }]}
          pointerEvents="none"
        />
      ) : null}

      {/* Two scrims, not one: a top scrim so the progress bar and close button
          stay legible, and a much heavier bottom scrim carrying the copy. */}
      <LinearGradient
        colors={['rgba(0,0,0,0.75)', 'transparent']}
        style={[styles.scrimTop, { height: insets.top + 120 }]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']}
        locations={[0, 0.4, 1]}
        style={styles.scrimBottom}
        pointerEvents="none"
      />

      {/* Tap zones sit UNDER the chrome in z-order but over the image, so the
          close button still wins the touch. Left third goes back — the
          Instagram convention users already have muscle memory for. */}
      <Pressable style={styles.tapBack} onPress={() => go(-1)} />
      <Pressable style={styles.tapNext} onPress={() => go(1)} />

      {/* No chevron affordances: tap-to-advance is an established story
          convention and the arrows read as clutter over the photography. The
          one-time hint below covers first-run discovery instead. */}

      {/* One-time nudge, first frame only. */}
      {index === 0 ? (
        <View style={[styles.tapHint, { bottom: insets.bottom + 8 }]} pointerEvents="none">
          <Text style={styles.tapHintText}>Tap to continue</Text>
        </View>
      ) : null}

      <View style={[styles.chromeTop, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <ProgressBar frames={frames} index={index} accent={theme.accent} />
        <View style={styles.chromeRow} pointerEvents="box-none">
          <Text style={styles.actLabel}>{ACT_LABELS[frame.act]}</Text>
          <Pressable onPress={exit} hitSlop={14} style={styles.close}>
            <FontAwesome name="times" size={17} color="rgba(255,255,255,0.85)" />
          </Pressable>
        </View>
      </View>

      {/* pointerEvents="none", not "box-none". box-none still lets CHILDREN
          capture touches, and FrameContent's wrapper View has default pointer
          events — so the whole copy block was swallowing taps. That's the
          bottom third of the screen, including the exact spot the "Tap to
          continue" hint points at. Nothing in here is interactive, so the
          entire subtree opts out and taps fall through to the zones below. */}
      <View
        style={[styles.frameBody, { paddingBottom: insets.bottom + 28 }]}
        pointerEvents="none"
      >
        <FrameContent frame={frame} accent={theme.accent} />
      </View>
    </View>
  );
}

// --- Ken Burns --------------------------------------------------------------
// One layer, edge-to-edge, with a slow reveal pan.
//
// THE GEOMETRY PROBLEM
// Stills are 16:9 (1.78); the screen is ~9:16 (0.46). Covering the screen means
// the image renders ~3.85x wider than the viewport, so most of the frame sits
// off-screen at any instant.
//
// Two earlier attempts and why they failed:
//   - Static cover: only ~26% of the frame ever visible, and a w780 source
//     upscaled 5.8x to fill it, which is where the pixelation came from.
//     (Fixed at the source: assets are now fetched at `original`.)
//   - Contain-over-blurred-fill: shows the whole frame, but a sharp image
//     floating on a zoomed copy of itself reads as a header pasted on a
//     background, not as one photograph.
//
// What actually works is to stop treating the overflow as a problem and use it:
// keep true fullscreen cover, and PAN across the frame over the frame's
// lifetime. You still see the whole image, just over time rather than at once —
// which is how film handles this exact situation, and it's why the movement
// reads as intentional rather than as a crop.
//
// The pan is proportional to how much is actually off-screen, measured from the
// image's real dimensions on load. A 2:3 character portrait barely overflows, so
// it barely moves; a 16:9 still overflows a lot, so it travels.

function KenBurns({
  uri,
  frameKey,
  runLength,
  width,
  height,
}: {
  uri: string;
  frameKey: number;
  /** Consecutive frames sharing this image; the pan is spread across all of them. */
  runLength: number;
  width: number;
  height: number;
}) {
  const scale = useSharedValue(1);
  const shift = useSharedValue(0);
  const fade = useSharedValue(0);
  const prevUri = useRef<string | null>(null);

  // The outgoing image, held beneath the incoming one until it has loaded.
  const [underlay, setUnderlay] = useState<string | null>(null);

  // Real aspect from the decoded image. Defaults to 16:9 so the first render
  // before onLoad is close for stills, then corrects for portraits.
  const [aspect, setAspect] = useState(16 / 9);

  // Cover geometry, computed rather than delegated to contentFit, because we
  // need to know the overflow in order to pan across it.
  const coverW = aspect > width / height ? height * aspect : width;
  const coverH = aspect > width / height ? height : width / aspect;
  const overflowX = Math.max(0, coverW - width);
  // Travel a fraction of the overflow — enough to reveal meaningfully more of
  // the frame without the movement becoming the thing you notice. Capped so a
  // very wide asset doesn't turn into a slideshow whip-pan.
  const pan = Math.min(overflowX * 0.28, 130);

  useEffect(() => {
    const previous = prevUri.current;

    // Same picture as the previous frame — do nothing at all.
    //
    // Consecutive frames often share an image: every character card uses the
    // key art, and a finale's still pool can be smaller than the number of
    // beats anchored to it. Restarting the pan there snapped the image back to
    // its start position on each tap, and since the picture is identical, that
    // snap is the ONLY thing you perceive — it reads as a glitch.
    //
    // Returning early leaves the existing animation running, so the pan
    // continues uninterrupted beneath the changing caption: one long camera
    // move across the run, the way film holds a shot. It also leaves `fade` at
    // 1, so there's no re-fade of an identical image.
    if (previous === uri) return;

    prevUri.current = uri;

    // Keep the outgoing image underneath until the incoming one has decoded.
    // The fade-in is fired by onLoad rather than on a timer — fading on a fixed
    // schedule meant that whenever the image wasn't cached we faded in nothing,
    // so the copy appeared a beat before its picture.
    if (previous) setUnderlay(previous);
    fade.value = 0;

    // Pan across the frame, starting from one edge of the available overflow
    // and travelling to the other. Direction alternates per run — panning the
    // same way every time reads as a mechanical tic.
    const dir = frameKey % 2 === 0 ? 1 : -1;
    // Stretched over the whole run so a 3-frame hold gets one slow traverse
    // rather than finishing early and sitting static for the last two taps.
    const duration = KEN_BURNS_MS * Math.max(1, runLength);
    scale.value = 1;
    shift.value = dir * (pan / 2);
    // Very slight push-in on top of the pan. Enough to keep the frame alive
    // when the image is portrait and there's almost no overflow to travel.
    scale.value = withTiming(1.05, { duration, easing: Easing.linear });
    shift.value = withTiming(-dir * (pan / 2), { duration, easing: Easing.linear });
  }, [frameKey, uri, pan, runLength, scale, shift, fade]);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateX: shift.value }],
    opacity: fade.value,
  }));

  const layerBox = {
    position: 'absolute' as const,
    // Centre the oversized image, then let translateX pan within it.
    left: (width - coverW) / 2,
    top: (height - coverH) / 2,
    width: coverW,
    height: coverH,
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.kenBurnsClip]} pointerEvents="none">
      {/* Outgoing frame. Static and fully opaque; the incoming image fades over
          the top of it, so the screen is never empty mid-transition. */}
      {underlay && underlay !== uri ? (
        <View style={layerBox}>
          <Image
            source={{ uri: underlay }}
            style={{ width: coverW, height: coverH }}
            contentFit="cover"
            transition={0}
            cachePolicy="memory-disk"
          />
        </View>
      ) : null}

      <Animated.View style={[layerBox, imageStyle]}>
        <Image
          source={{ uri }}
          style={{ width: coverW, height: coverH }}
          contentFit="cover"
          transition={0}
          cachePolicy="memory-disk"
          onLoad={e => {
            const { width: iw, height: ih } = e.source;
            if (iw && ih) setAspect(iw / ih);
            // The transition starts here, once there is genuinely something to
            // show — not on a timer that may fire before the bytes arrive.
            fade.value = withTiming(1, { duration: 260 });
          }}
        />
      </Animated.View>
    </View>
  );
}

// --- progress bar -----------------------------------------------------------
// One segment per frame, GROUPED by act with a gap between groups. The grouping
// is the point: it tells you there are four chapters and roughly how long each
// one is, which a flat 20-segment bar would not.

function ProgressBar({
  frames,
  index,
  accent,
}: {
  frames: RecapFrame[];
  index: number;
  accent: string;
}) {
  const groups = useMemo(
    () =>
      ACT_ORDER.map(act => ({
        act,
        indices: frames.reduce<number[]>((acc, f, i) => (f.act === act ? [...acc, i] : acc), []),
      })).filter(g => g.indices.length > 0),
    [frames],
  );

  return (
    <View style={styles.progressRow}>
      {groups.map(group => (
        <View key={group.act} style={[styles.progressGroup, { flex: group.indices.length }]}>
          {group.indices.map(i => (
            <View
              key={i}
              style={[
                styles.progressSeg,
                { backgroundColor: i <= index ? accent : 'rgba(255,255,255,0.28)' },
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

// --- frame renderers --------------------------------------------------------

function FrameContent({ frame, accent }: { frame: RecapFrame; accent: string }) {
  switch (frame.kind) {
    case 'title':
      return (
        <View>
          <Text style={styles.kicker}>{frame.kicker}</Text>
          <Text style={styles.bigTitle}>{frame.title}</Text>
          <View style={[styles.rule, { backgroundColor: accent }]} />
          <Text style={styles.meta}>{frame.meta}</Text>
        </View>
      );

    case 'character':
      // No inset portrait — the headshot is the frame's full-bleed image now,
      // so repeating it in a circle would be showing the same face twice.
      return (
        <View>
          <Text style={styles.charName}>{frame.name}</Text>
          {frame.actor ? (
            <Text style={[styles.charActor, { color: accent }]}>{frame.actor}</Text>
          ) : (
            <View style={styles.actorSpacer} />
          )}
          <Text style={styles.body}>{frame.line}</Text>
          {frame.note ? <Text style={styles.note}>{frame.note}</Text> : null}
        </View>
      );

    case 'beat':
      return (
        <View>
          <Text style={[styles.beatLabel, { color: accent }]}>{frame.label}</Text>
          <Text style={styles.beatText}>{frame.text}</Text>
        </View>
      );

    case 'cliffhanger':
      return (
        <View>
          <Text style={styles.kicker}>{frame.kicker}</Text>
          <Text style={styles.beatText}>{frame.text}</Text>
          <View style={styles.questions}>
            {frame.questions.map(q => (
              <View key={q} style={styles.questionRow}>
                <View style={[styles.questionDot, { backgroundColor: accent }]} />
                <Text style={styles.questionText}>{q}</Text>
              </View>
            ))}
          </View>
        </View>
      );
  }
}

// Static — this screen intentionally does not follow the theme background, so
// there's nothing here that needs to be rebuilt per palette.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },

  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0 },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '62%' },

  // 25/75. Instagram and Snapchat both sit around a third for the back zone;
  // a quarter keeps that convention while biasing toward the action taken far
  // more often, and leaves the whole centre — where the hint points — forward.
  tapBack: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '25%' },
  tapNext: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '75%' },

  chromeTop: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14 },
  chromeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingHorizontal: 2,
  },
  actLabel: {
    fontSize: 12,
    fontFamily: 'DMSans_700Bold',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  close: { padding: 4 },

  progressRow: { flexDirection: 'row', gap: 8 },
  progressGroup: { flexDirection: 'row', gap: 3 },
  progressSeg: { flex: 1, height: 2.5, borderRadius: 2 },

  frameBody: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 26,
  },

  kicker: {
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
    color: 'rgba(255,255,255,0.66)',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  bigTitle: {
    fontSize: 54,
    fontFamily: 'DMSans_700Bold',
    color: '#fff',
    letterSpacing: 6,
    marginTop: 6,
  },
  rule: { width: 46, height: 3, borderRadius: 2, marginTop: 16, marginBottom: 14 },
  meta: {
    fontSize: 14,
    fontFamily: 'DMSans_500Medium',
    color: 'rgba(255,255,255,0.72)',
  },

  // Clips the oversized pan layer to the screen.
  kenBurnsClip: { overflow: 'hidden', backgroundColor: '#000' },


  tapHint: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  tapHintText: {
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 0.4,
  },

  charName: {
    fontSize: 30,
    fontFamily: 'DMSans_700Bold',
    color: '#fff',
    letterSpacing: -0.4,
  },
  charActor: {
    fontSize: 13,
    fontFamily: 'DMSans_700Bold',
    letterSpacing: 0.6,
    marginTop: 3,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  // Holds the name-to-body rhythm steady on cards with no actor credit.
  actorSpacer: { height: 12 },
  body: {
    fontSize: 17,
    lineHeight: 25,
    fontFamily: 'DMSans_400Regular',
    color: 'rgba(255,255,255,0.9)',
  },
  note: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'DMSans_500Medium',
    color: 'rgba(255,255,255,0.6)',
    marginTop: 10,
    fontStyle: 'italic',
  },

  beatLabel: {
    fontSize: 12,
    fontFamily: 'DMSans_700Bold',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  beatText: {
    fontSize: 22,
    lineHeight: 31,
    fontFamily: 'DMSans_500Medium',
    color: '#fff',
    letterSpacing: -0.2,
  },

  questions: { marginTop: 24, gap: 12 },
  questionRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  questionDot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  questionText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 23,
    fontFamily: 'DMSans_400Regular',
    color: 'rgba(255,255,255,0.86)',
  },

  missing: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 10 },
  missingText: { color: '#fff', fontFamily: 'DMSans_500Medium', fontSize: 16 },
  missingLink: { fontFamily: 'DMSans_700Bold', fontSize: 15 },
});
