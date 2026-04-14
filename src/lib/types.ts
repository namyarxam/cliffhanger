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
}

/** Full show data with seasons and episodes */
export interface ShowFull extends ShowSummary {
  seasons: Season[];
  totalSeasons: number;
  totalEpisodes: number;
  rating: number | null;
}

// ─── New types for mobile app ───────────────────────────────────────────────

export type WatchStatus = 'want_to_watch' | 'currently_watching' | 'watched';

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
  new_episodes_seen_at: string | null;
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
  show_top4_in_list: boolean;
  show_posters_in_list: boolean;
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

export interface Conversation {
  id: string;
  name: string | null;
  show_id: string | null;
  show_title: string | null;
  show_image: string | null;
  spoiler_lock: boolean;
  created_by: string;
  last_message_at: string;
  created_at: string;
}

export interface ConversationPreview extends Conversation {
  member_names: string[];
  member_count: number;
  last_message: string | null;
  last_message_sender: string | null;
}

export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  current_season: number;
  current_episode: number;
  show_status: WatchStatus | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  user_id: string;
  message: string | null;
  gif_url: string | null;
  created_at: string;
  sender_name: string;
  sender_avatar: string | null;
}

export type ConversationInviteStatus = 'pending' | 'accepted' | 'declined';

export interface ConversationInvite {
  id: string;
  conversation_id: string;
  invited_by: string;
  invited_user: string;
  status: ConversationInviteStatus;
  created_at: string;
}

export interface ConversationInviteWithDetails {
  id: string;
  conversation_id: string;
  conversation_name: string | null;
  show_title: string | null;
  show_image: string | null;
  invited_by_name: string;
  member_names: string[];
  status: ConversationInviteStatus;
  created_at: string;
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
