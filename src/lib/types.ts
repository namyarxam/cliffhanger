// ─── Ported from web app ────────────────────────────────────────────────────

export interface Episode {
  e: number;
  t: string;
  r: number;
  v: number;
}

export interface Season {
  s: number;
  eps: Episode[];
}

/** Lightweight show data for the rankings list (from rankings.json) */
export interface ShowSummary {
  id: string; // IMDB tconst, e.g. "tt0903747"
  title: string;
  year: number | null;
  endYear: number | null;
  genre: string;
  genres: string[];
  seasons: number;
  totalEpisodes: number;
  overallRating: number;
  totalRatings: number;
  lastAired?: string | null;
}

/** Full show data with episodes (from shows/{id}.json) */
export interface ShowFull extends ShowSummary {
  episodes: Season[];
  network?: string | null;
  summary?: string | null;
  image?: string | null;
}

// ─── New types for mobile app ───────────────────────────────────────────────

export type WatchStatus = 'want_to_watch' | 'currently_watching' | 'watched';

export interface UserShow {
  user_id: string;
  show_id: string;
  status: WatchStatus;
  current_season: number;
  current_episode: number;
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
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  show_id: string;
  created_by: string;
  invite_code: string;
  created_at: string;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  joined_at: string;
  display_name: string;
  avatar_url: string | null;
  current_season: number;
  current_episode: number;
}

export interface GroupMessage {
  id: string;
  group_id: string;
  user_id: string;
  message: string;
  created_at: string;
  sender_name: string;
  sender_avatar: string | null;
}

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
