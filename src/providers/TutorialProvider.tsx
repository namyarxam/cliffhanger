import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/src/providers/AuthProvider';
import Coachmark from '@/src/components/Coachmark';

export type CoachmarkGesture = 'tap' | 'longpress' | 'drag-horizontal' | 'drag-vertical';

// Static info a hook registers up-front so the provider can stage chain
// handoffs atomically — when the user dismisses A, we already know B's
// target rect, copy, and gesture, and can promote it inside the same
// setState batch with no render where neither is active.
export interface RegisteredCoachmark {
  id: string;
  target: { x: number; y: number; w: number; h: number };
  gesture: CoachmarkGesture;
  title: string;
  body?: string;
  priority?: number;
  // Chain link: this coachmark waits to fire until `showAfter` is dismissed,
  // OR — if `showAfter` was already seen in a previous session — falls back
  // to normal visibility based on the hook's `when` predicate.
  showAfter?: string;
  // Override for the cutout ring + gesture hint color. Defaults to theme.accent
  // when unset. Use this when the highlighted element is itself accent-colored
  // (e.g., the orange show-detail status pills) so the indicators read against
  // the target rather than blending into it.
  highlightColor?: string;
}

interface TutorialCtx {
  hasSeen: (id: string) => boolean;
  // Used by useCoachmark — register the cached measurement + chain link.
  // Idempotent on identical info (avoids re-render thrash from re-measures).
  register: (info: RegisteredCoachmark) => void;
  unregister: (id: string) => void;
  // Used by useCoachmark — request to be made visible (when predicate flipped
  // true AND no chain is gating). Withdraws the request when no longer eligible.
  setVisible: (id: string, visible: boolean) => void;
  dismissActive: () => void;
}

const TutorialContext = createContext<TutorialCtx>({
  hasSeen: () => true,
  register: () => {},
  unregister: () => {},
  setVisible: () => {},
  dismissActive: () => {},
});

export function useTutorial() {
  return useContext(TutorialContext);
}

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const { profile, markCoachmarkSeen } = useAuth();
  // Source of truth for "what coachmarks exist and what they look like."
  // Hooks register/unregister regardless of whether they're currently shown.
  const [registry, setRegistry] = useState<Map<string, RegisteredCoachmark>>(() => new Map());
  // Subset of registry that's currently asking to be shown. The hook's `when`
  // predicate drives this. The chain handoff in dismissActive also writes here.
  const [visible, setVisible] = useState<Set<string>>(() => new Set());
  // Intra-session de-dupe: once a user dismisses A, even if its conditions
  // would make it eligible again, don't re-show it this session.
  const justDismissed = useRef<Set<string>>(new Set());
  // Read latest registry from inside dismissActive's setState batch without
  // making it a stale-closure dep. Mirrors the standard ref pattern.
  const registryRef = useRef(registry);
  registryRef.current = registry;

  const seen = profile?.coachmarks_seen ?? [];
  const hasSeen = useCallback((id: string) => seen.includes(id), [seen]);

  // Reset Tips (Settings → resetCoachmarks) only clears the persistent `seen`
  // array. Without this prune, `justDismissed` would keep suppressing every
  // coachmark the user dismissed earlier in the session — the user would see
  // nothing replay until a full app restart. Reconciling against `seen` means
  // any ID that's no longer marked seen also drops out of justDismissed.
  useEffect(() => {
    const prev = justDismissed.current;
    if (prev.size === 0) return;
    const next = new Set<string>();
    for (const id of prev) if (seen.includes(id)) next.add(id);
    if (next.size !== prev.size) justDismissed.current = next;
  }, [seen]);

  const register = useCallback((info: RegisteredCoachmark) => {
    setRegistry(prev => {
      const existing = prev.get(info.id);
      // Same info? Skip — avoids state-update churn from hooks that re-measure
      // each render even though the layout didn't actually move.
      if (existing
        && existing.target.x === info.target.x
        && existing.target.y === info.target.y
        && existing.target.w === info.target.w
        && existing.target.h === info.target.h
        && existing.gesture === info.gesture
        && existing.title === info.title
        && existing.body === info.body
        && existing.priority === info.priority
        && existing.showAfter === info.showAfter
        && existing.highlightColor === info.highlightColor) return prev;
      const next = new Map(prev);
      next.set(info.id, info);
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setRegistry(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setVisible(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const setVisibleFor = useCallback((id: string, visible: boolean) => {
    setVisible(prev => {
      const has = prev.has(id);
      if (has === visible) return prev;
      const next = new Set(prev);
      if (visible) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Pick the active coachmark: among registered entries that are visible,
  // not-just-dismissed, and not-already-seen, take the highest-priority one
  // (last in insertion order on ties).
  const active = useMemo<RegisteredCoachmark | null>(() => {
    if (visible.size === 0) return null;
    let best: RegisteredCoachmark | null = null;
    for (const id of visible) {
      if (justDismissed.current.has(id)) continue;
      if (hasSeen(id)) continue;
      const info = registry.get(id);
      if (!info) continue;
      if (!best || (info.priority ?? 0) >= (best.priority ?? 0)) best = info;
    }
    return best;
  }, [visible, registry, hasSeen]);

  const dismissActive = useCallback(() => {
    if (!active) return;
    const dismissedId = active.id;
    justDismissed.current.add(dismissedId);
    markCoachmarkSeen(dismissedId);

    // Atomic chain handoff: in the same setState batch that removes A from
    // visible, walk the registry for any coachmark with showAfter=A and add
    // it to visible. Active recomputes inside the same render → B becomes
    // active without ever passing through "active = null" → Coachmark stays
    // mounted → swap reads as one continuous tip.
    setVisible(prev => {
      const next = new Set(prev);
      next.delete(dismissedId);
      for (const info of registryRef.current.values()) {
        if (info.showAfter === dismissedId
            && !justDismissed.current.has(info.id)
            && !hasSeen(info.id)) {
          next.add(info.id);
        }
      }
      return next;
    });
  }, [active, markCoachmarkSeen, hasSeen]);

  const value = useMemo<TutorialCtx>(() => ({
    hasSeen,
    register,
    unregister,
    setVisible: setVisibleFor,
    dismissActive,
  }), [hasSeen, register, unregister, setVisibleFor, dismissActive]);

  return (
    <TutorialContext.Provider value={value}>
      {children}
      {active && (
        // No `key={active.id}`: when the active swaps mid-session (chain
        // handoff), React reuses the same <Coachmark> instance instead of
        // unmount/remount. The scrim stays at full opacity, the tooltip
        // text snaps to the new copy, the gesture hint swaps. Reads as a
        // single morphing tip rather than two flashes.
        <Coachmark
          target={active.target}
          gesture={active.gesture}
          title={active.title}
          body={active.body}
          highlightColor={active.highlightColor}
          onDismiss={dismissActive}
        />
      )}
    </TutorialContext.Provider>
  );
}
