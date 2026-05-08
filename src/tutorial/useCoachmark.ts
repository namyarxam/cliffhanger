import { useEffect, useRef } from 'react';
import { findNodeHandle, UIManager } from 'react-native';
import { useTutorial, type CoachmarkGesture } from '@/src/providers/TutorialProvider';
import type { CoachmarkId } from './registry';

interface Options {
  id: CoachmarkId;
  // Eligibility predicate. The hook only requests visibility when this is
  // true. Falling false (e.g., user navigates away, target unmounts) hides
  // the coachmark again.
  when: boolean;
  // The element to highlight. Use a ref attached to the actual View / poster
  // / pressable that demonstrates the gesture.
  ref: React.RefObject<unknown> | React.MutableRefObject<unknown>;
  gesture: CoachmarkGesture;
  title: string;
  body?: string;
  // Defer measurement by this many ms after the ref settles. Lets entrance
  // animations or scroll finish so we measure the final layout. Defaults
  // to 400ms (one animation cycle).
  delay?: number;
  priority?: number;
  // Sequential coachmarks: this one waits to fire until `showAfter` is
  // dismissed. The provider's chain handoff runs inside dismissActive's
  // setState batch — no render where neither is active, so the swap reads
  // as a single morphing tip. If `showAfter` was already dismissed in a
  // previous session, this coachmark falls back to normal `when`-based
  // visibility (chain only matters when both are unseen).
  showAfter?: CoachmarkId;
  // Override the cutout ring + gesture hint color. Defaults to the theme's
  // accent color. Pass a contrasting value when the highlighted element is
  // itself accent-colored (e.g., the orange show-detail status pills) so
  // the indicators don't blend into the target.
  highlightColor?: string;
}

// Register a coachmark for a screen-bound element. The hook does two things:
// (1) measures the target after `delay` and registers cached info with the
// provider so chain handoffs can fire atomically; (2) drives visibility via
// `when` (or waits for chain handoff if `showAfter` is set + unseen).
export function useCoachmark(opts: Options) {
  const { hasSeen, register, unregister, setVisible } = useTutorial();
  // Stable copies so re-renders with new closures don't thrash the registry.
  const stable = useRef({ title: opts.title, body: opts.body, gesture: opts.gesture, priority: opts.priority, showAfter: opts.showAfter, highlightColor: opts.highlightColor });
  stable.current = { title: opts.title, body: opts.body, gesture: opts.gesture, priority: opts.priority, showAfter: opts.showAfter, highlightColor: opts.highlightColor };
  // hasSeen is a useCallback keyed on profile.coachmarks_seen — its identity
  // flips every time ANY coachmark is dismissed. We can't put it in Effect 1's
  // deps without re-running cleanup-then-body for every other registered
  // coachmark on the screen, which unregisters them mid-chain-handoff and
  // produces a flash (active=null between the unregister and the 400ms
  // re-register timeout). Reading via a ref keeps the mount-time skip-if-seen
  // optimization without making registration churn on dismiss.
  const hasSeenRef = useRef(hasSeen);
  hasSeenRef.current = hasSeen;

  // ─── Effect 1: measure + register cached info ───────────────────────────
  // Re-runs when `when` flips so we measure once the target is actually
  // mounted. Without the `when` gate we'd schedule the measure at hook-mount
  // time, before async data has populated and the highlighted element exists
  // on screen — `ref.current` would be null when setTimeout fires, the
  // measure would bail silently, and the coachmark would never register.
  // Tying the measure to `when=true` means we only schedule it once the
  // predicate is satisfied (data loaded, target rendered).
  useEffect(() => {
    if (hasSeenRef.current(opts.id)) return;
    if (!opts.when) return;
    let cancelled = false;

    const measure = () => {
      const node = opts.ref.current as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
      if (cancelled || !node) return;

      const fire = (x: number, y: number, w: number, h: number) => {
        if (cancelled) return;
        if (w <= 0 || h <= 0) return;
        register({
          id: opts.id,
          target: { x, y, w, h },
          gesture: stable.current.gesture,
          title: stable.current.title,
          body: stable.current.body,
          priority: stable.current.priority,
          showAfter: stable.current.showAfter,
          highlightColor: stable.current.highlightColor,
        });
      };

      if (typeof node.measureInWindow === 'function') {
        node.measureInWindow(fire);
        return;
      }
      // Fallback for refs that wrap a host view but don't expose
      // measureInWindow directly (e.g., gesture handler views).
      const handle = findNodeHandle(node as Parameters<typeof findNodeHandle>[0]);
      if (handle != null) UIManager.measureInWindow(handle, fire);
    };

    const timer = setTimeout(measure, opts.delay ?? 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unregister(opts.id);
    };
  }, [opts.id, opts.ref, opts.delay, opts.when, register, unregister]);

  // ─── Effect 2: drive visibility based on `when` + chain ─────────────────
  // Separate effect so changes to `when` don't tear down the registration
  // (no re-measurement on every state flip). If `showAfter` is set and the
  // chain target is still unseen, this hook waits for chain handoff instead
  // of pushing visibility on its own.
  useEffect(() => {
    if (hasSeen(opts.id)) {
      setVisible(opts.id, false);
      return;
    }
    if (!opts.when) {
      setVisible(opts.id, false);
      return;
    }
    // Chain gating: while the predecessor is still unseen, don't show
    // ourselves — wait for the chain handoff in dismissActive.
    if (opts.showAfter && !hasSeen(opts.showAfter)) {
      setVisible(opts.id, false);
      return;
    }
    setVisible(opts.id, true);
  }, [opts.when, opts.id, opts.showAfter, hasSeen, setVisible]);
}
