// ─── TVMaze-based types ─────────────────────────────────────────────────────

export interface Episode {
  number: number;
  title: string;
  rating: number | null;
  airdate: string | null;
  airtime: string | null;
  runtime: number | null;
  image: string | null;
  imageOriginal: string | null;
  summary: string | null;
}

export interface Season {
  number: number;
  episodes: Episode[];
}

/** Lightweight show data for search results */
export interface ShowSummary {
  id: string; // TVMaze show ID (as string for consistency)
  title: string;
  year: number | null;
  endYear: number | null;
  genre: string;
  genres: string[];
  image: string | null;
  network: string | null;
  status: string | null; // "Running", "Ended", etc.
  summary: string | null;
  // TVMaze programme type ("Scripted", "Reality", "Animation", …). Optional
  // because most call sites predate it; populated by search so the Recap
  // request screen can gate non-scripted shows client-side.
  type?: string | null;
}

export interface ShowCastMember {
  personName: string;
  characterName: string;
  image: string | null;
}

export interface ShowNextEpisode {
  season: number;
  number: number;
  name: string;
  airdate: string | null;
  airtime: string | null;
  airstamp: string | null;
}

/** Full show data with seasons and episodes */
export interface ShowFull extends ShowSummary {
  seasons: Season[];
  totalSeasons: number;
  totalEpisodes: number;
  rating: number | null;
  runtime: number | null;
  type: string | null;
  language: string | null;
  officialSite: string | null;
  cast: ShowCastMember[];
  nextEpisode: ShowNextEpisode | null;
}

// ─── New types for mobile app ───────────────────────────────────────────────

export type WatchStatus = 'want_to_watch' | 'currently_watching' | 'watched' | 'muted';

// Centralized TVMaze metadata. One row per show_id, shared by every user
// tracking the show. Mutated by the refresh-show-metadata cron and by
// addShow / cacheShowMetadata on the client.
export interface Show {
  show_id: string;
  show_title: string;
  show_image: string | null;
  show_network: string | null;
  show_status: string | null;
  next_episode_airdate: string | null;
  next_episode_season: number | null;
  next_episode_episode: number | null;
  next_episode_airstamp: string | null;
  next_episode_airtime: string | null;
  last_aired_season: number | null;
  last_aired_episode: number | null;
  last_aired_airdate: string | null;
  returning_announced_at: string | null;
  total_aired_episodes: number | null;
  updated_at: string;
}

// Flat read shape served by the `user_shows_full` view. Consuming code keeps
// the same field access it had before the shows table was split out — the view
// joins shows back in. Writes go to `user_shows` (per-user) or `shows`
// (shared) directly.
export interface UserShow {
  user_id: string;
  show_id: string;
  status: WatchStatus;
  show_title: string;
  show_image: string | null;
  show_network: string | null;
  current_season: number;
  current_episode: number;
  current_episode_airdate: string | null;
  next_episode_airdate: string | null;
  next_episode_season: number | null;
  next_episode_episode: number | null;
  next_episode_airstamp: string | null;
  next_episode_airtime: string | null;
  show_status: string | null;
  last_aired_season: number | null;
  last_aired_episode: number | null;
  last_aired_airdate: string | null;
  returning_announced_at: string | null;
  returning_seen_at: string | null;
  total_aired_episodes: number | null;
  new_episodes_seen_at: string | null;
  caught_up: boolean;
  notify: boolean;
  rating: number | null;
  added_at: string;
  updated_at: string;
}

export interface EpisodeWatch {
  user_id: string;
  show_id: string;
  season: number;
  episode: number;
  watched_at: string;
}

export interface UserProfile {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  push_new_episodes: boolean;
  notify_all_current: boolean;
  push_friend_requests: boolean;
  show_posters_in_list: boolean;
  hide_ratings: boolean;
  theme: string | null;
  onboarded_at: string | null;
  coachmarks_seen: string[];
  /** Last app open, throttled to once an hour. Null means not seen since
   *  last_seen_at started being recorded — deliberately not backfilled. */
  last_seen_at: string | null;
  created_at: string;
}

export type FriendshipStatus = 'pending' | 'accepted';

export interface Friendship {
  id: string;
  user_id: string;
  friend_id: string;
  status: FriendshipStatus;
  created_at: string;
  updated_at: string;
}

export interface FriendWithProfile {
  friendship_id: string;
  user: UserProfile;
  status: FriendshipStatus;
  is_incoming: boolean;
}

export type ListType = 'shows' | 'characters';

export interface List {
  id: string;
  user_id: string;
  name: string;
  type: ListType;
  is_display: boolean;
  created_at: string;
}

export interface ListItem {
  id: string;
  list_id: string;
  position: number;
  item_id: string;
  item_title: string;
  item_image: string | null;
  created_at: string;
}

export interface ListWithItems extends List {
  items: ListItem[];
}

// Chat types (Conversation, ConversationPreview, ConversationMember,
// Message) were removed along with the chat feature. The conversations,
// conversation_members and messages TABLES are deliberately retained, so
// these types are gone but the data is not.
//
// Two things still touch those tables without going through here:
// src/lib/moderation.ts deletes DMs when one user blocks another, and the
// delete-account Edge Function clears them on account deletion. Both use
// inline types and neither needs this file.

export interface ScheduleEntry {
  show_id: string;
  tvmaze_id: number;
  season: number;
  episode: number;
  name: string;
  airdate: string;
  airtime: string;
  runtime: number;
  network: string;
}
