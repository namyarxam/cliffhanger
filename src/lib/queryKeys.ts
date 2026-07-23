/**
 * Centralized TanStack Query keys. Functions returning tuples so TS
 * enforces userId/showId/etc. arguments at every call site — typos can't
 * silently miss the cache. Each top-level domain ('userShows', 'profile',
 * etc.) gets a `.all` for broad invalidation and per-row helpers for
 * surgical writes/invalidations.
 *
 * Pattern:
 *   queryClient.invalidateQueries({ queryKey: qk.userShows.all(userId) })
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

  // Profile
  profile: (userId: string | undefined) => ['profile', userId] as const,

  // Moderation
  blocked: (userId: string | undefined) => ['blocked', userId] as const,
};
