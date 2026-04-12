// ─── Collection Helpers ────────────────────────────────────────────────────

/** Build a Map keyed by `id` from an array of objects (e.g. Supabase profile rows). */
export function buildMap<T extends { id: string }>(rows: T[] | null | undefined): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows ?? []) map.set(row.id, row);
  return map;
}

/** Build a Map of id → display_name from profile rows. */
export function buildNameMap(rows: { id: string; display_name: string }[] | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows ?? []) map.set(row.id, row.display_name);
  return map;
}

// ─── Rating Color Scale (ported verbatim from web app) ──────────────────────

export function getRatingColor(rating: number): string {
  if (rating >= 9.5) return '#ff2d2d';
  if (rating >= 9.0) return '#ff6b35';
  if (rating >= 8.5) return '#ffa826';
  if (rating >= 8.0) return '#d4c025';
  if (rating >= 7.5) return '#7bcf4e';
  if (rating >= 7.0) return '#3db88c';
  if (rating >= 6.5) return '#2d9db8';
  if (rating >= 6.0) return '#4185cf';
  if (rating >= 5.0) return '#5571b8';
  return '#6b6b8a';
}

export function getRatingGlow(rating: number): string {
  const c = getRatingColor(rating);
  return rating >= 9.0 ? `0 0 12px ${c}55, 0 0 4px ${c}33` : 'none';
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function formatVotes(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
  return n.toString();
}

// ─── Live Detection ─────────────────────────────────────────────────────────

const LIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function isLive(lastAired?: string | null): boolean {
  if (!lastAired) return false;
  const diff = Date.now() - new Date(lastAired).getTime();
  return diff >= 0 && diff < LIVE_WINDOW_MS;
}

// ─── Math ───────────────────────────────────────────────────────────────────

export function linReg(pts: { x: number; y: number }[]) {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  pts.forEach(({ x, y }) => { sx += x; sy += y; sxy += x * y; sx2 += x * x; });
  const d = n * sx2 - sx * sx;
  if (Math.abs(d) < 1e-10) return null;
  const m = (n * sxy - sx * sy) / d;
  return { m, b: (sy - m * sx) / n };
}
