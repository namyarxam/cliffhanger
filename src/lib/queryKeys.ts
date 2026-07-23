/**
 * Centralized TanStack Query keys. Functions returning tuples so TS
 * enforces userId/showId/etc. arguments at every call site — typos can't
 * silently miss the cache. Each top-level domain ('userShows', 'profile',
 * etc.) gets a `.all` for broad invalidation and per-row helpers for
 * surgical writes/invalidations.
 *
 * Pattern:
 *   invalidateProgress(queryClient, userId)   // see the bottom of this file
 *   queryClient.setQueryData(qk.userShow(userId, showId), updater)
 *
 * Keys are user-scoped wherever data is per-user — never share a cache
 * across users (sign-out clears all queries, but during a session
 * defensive scoping protects against bugs).
 */
export const qk = {
  // My Shows + per-user lists
  userShows: {
    all: (userId: string | undefined) => ['userShows', userId] as const,
  },
  nextEpisodes: (userId: string | undefined) => ['nextEpisodes', userId] as const,
  airingToday: (userId: string | undefined) => ['airingToday', userId] as const,
  watchedCounts: (userId: string | undefined) => ['watchedCounts', userId] as const,
  returnAnnouncements: (userId: string | undefined) => ['returnAnnouncements', userId] as const,
  popular: (userId: string | undefined, limit?: number) => ['popular', userId, limit] as const,
  airingThisWeek: (userId: string | undefined) => ['airingThisWeek', userId] as const,
  topRated: (userId: string | undefined) => ['topRated', userId] as const,
  displayList: (userId: string | undefined) => ['displayList', userId] as const,

  // Show detail
  show: (showId: string | undefined) => ['show', showId] as const,
  userShow: (userId: string | undefined, showId: string | undefined) =>
    ['userShow', userId, showId] as const,
  watchedEps: (userId: string | undefined, showId: string | undefined) =>
    ['watchedEps', userId, showId] as const,
  friendsWatching: (userId: string | undefined, showId: string | undefined) =>
    ['friendsWatching', userId, showId] as const,
  listsContaining: (userId: string | undefined, showId: string | undefined) =>
    ['listsContaining', userId, showId] as const,

  // Friends + social
  friends: (userId: string | undefined) => ['friends', userId] as const,
  pendingRequests: (userId: string | undefined) => ['pendingRequests', userId] as const,
  pendingRequestCount: (userId: string | undefined) => ['pendingRequestCount', userId] as const,

  // Lists
  lists: (userId: string | undefined) => ['lists', userId] as const,

  // Recaps
  //
  // Keyed on userId because the list carries a per-viewer season cap — two
  // accounts on the same device must not share a cached list, or one could be
  // offered a season the other had earned.
  recaps: (userId: string | undefined) => ['recaps', userId] as const,
  recapSeasons: (userId: string | undefined, slug: string, from: number, through: number) =>
    ['recapSeasons', userId, slug, from, through] as const,

  // Profile
  profile: (userId: string | undefined) => ['profile', userId] as const,

  // Moderation
  blocked: (userId: string | undefined) => ['blocked', userId] as const,
};

/**
 * Invalidate everything derived from a user's watch progress.
 *
 * Changing progress or a show's status feeds more queries than it looks:
 * the watchlist itself, the next-episode and airing-today lookups, watched
 * counts, and the recap list, which carries a per-viewer season cap.
 *
 * This exists because that last one was missed. Thirteen separate call sites
 * invalidated the watchlist by hand and none of them knew about recaps, so
 * finishing a season left the Recap tab showing the old cap — for up to
 * thirty seconds by staleTime, and indefinitely in practice, because a tab
 * screen stays mounted and never refetches on a tab switch.
 *
 * Adding a fourteenth site is not the failure mode worth guarding against.
 * Adding a fifteenth QUERY is: one place to declare the dependency means the
 * next one cannot be forgotten at twelve of the callers.
 */
export function invalidateProgress(
  queryClient: { invalidateQueries: (o: { queryKey: readonly unknown[] }) => unknown },
  userId: string | undefined,
) {
  if (!userId) return;
  for (const key of [
    qk.userShows.all(userId),
    qk.nextEpisodes(userId),
    qk.airingToday(userId),
    qk.watchedCounts(userId),
    qk.recaps(userId),
  ]) {
    queryClient.invalidateQueries({ queryKey: key });
  }
}
