# Cliffhanger

A social TV show tracking app where you track what you're watching, see where your friends are in a show, and chat about episodes without spoilers.

Built with [Expo](https://expo.dev) (React Native), [Supabase](https://supabase.com), and [TVMaze API](https://www.tvmaze.com/api).

## Features

### Show Discovery & Search
- Live search powered by TVMaze API — type a show name, get instant results
- Show detail pages with poster, network, genre, season/episode counts
- "Airing" badge for currently running shows
- Upcoming episodes section with air dates for active shows

### Watchlists
- **Three-list system**: Want to Watch, Currently Watching, Watched
- One-tap status switching between lists
- Re-tap active status to remove (with confirmation, episode progress preserved)
- Network displayed for Want to Watch, episode progress for Currently Watching, checkmark for Watched

### Episode Tracking
- **Visual episode timeline** — horizontal scrollable strip of color-coded dots, one per episode, grouped by season
- **One-tap catch-up** — tap any episode and everything before it (across all seasons) marks as watched
- Tap backward to rewind progress
- Future episodes (not yet aired) are dimmed and non-selectable
- Red ring indicator on the latest aired episode
- Episode detail row shows title and formatted air date on tap

### Friends
- Search users by username
- Send, accept, and decline friend requests
- Mutual requests auto-accept
- View any friend's full watchlist
- Pending request badge on the Profile tab

### Groups
- Create groups tied to a specific show
- Invite friends via 8-character invite code (copy to clipboard)
- See every member's episode progress at a glance — front-runner highlighted
- **Quick group creation** from a friend's profile on shows you both watch

### Spoiler-Proof Group Chat
- One continuous chat per group (not per-episode)
- **Spoiler lock**: if you're behind the front-runner, the chat is locked with a message like "Catch up to S2 E8 to unlock"
- Catch up and the chat opens instantly
- Group owner can toggle spoiler lock off for casual groups
- Real-time messages via Supabase Realtime

### Live Schedule & Notifications
- Supabase Edge Function polls TVMaze schedule every 3 hours
- **New episodes indicator** on My Shows — orange dot with "New episodes" text when new episodes air beyond your current progress
- Dismisses when you tap into the show
- Push notification opt-in for new episode alerts
- Settings screen with notification toggle

### Profile & Settings
- User profile with avatar initial, display name, username
- Friends list with count and pending request badge
- Settings page with push notification preferences
- Sign out

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Expo (React Native), TypeScript, expo-router |
| Backend | Supabase (Postgres, Auth, Realtime, Edge Functions) |
| Data | TVMaze API (live search, show data, schedule) |
| Auth | Supabase Auth (email/password) |
| Chat | Supabase Realtime (Postgres changes) |
| Notifications | expo-notifications, Expo Push Service |
| Styling | StyleSheet.create(), custom dark theme, DM Sans font |

## Getting Started

### Prerequisites
- Node.js 18+
- [Expo Go](https://expo.dev/go) app on your phone
- A [Supabase](https://supabase.com) project

### Setup

1. Clone the repo and install dependencies:
   ```bash
   git clone git@github.com:namyarxam/cliffhanger.git
   cd cliffhanger
   npm install
   ```

2. Create a `.env` file with your Supabase credentials:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

3. Run the database migrations in order in your Supabase SQL Editor:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_watchlists.sql`
   - `supabase/migrations/003_add_episode_airdate.sql`
   - `supabase/migrations/004_add_show_network.sql`
   - `supabase/migrations/005_friendships.sql`
   - `supabase/migrations/006_groups.sql`
   - `supabase/migrations/007_spoiler_lock.sql`
   - `supabase/migrations/008_schedule.sql`

4. Start the dev server:
   ```bash
   npx expo start
   ```

5. Scan the QR code with your phone to open in Expo Go.

### Optional: Deploy the Schedule Edge Function

```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref your-project-ref
supabase functions deploy poll-schedule
```

Then set up the cron job in the SQL Editor to poll every 3 hours.

## Database Schema

```
profiles          — user profiles (auto-created on sign-up)
user_shows        — watchlists with episode progress
episode_watches   — individual episode tracking
friendships       — friend requests and connections
groups            — show groups with invite codes
group_members     — group membership
group_messages    — real-time group chat
schedule          — cached episode air dates from TVMaze
push_tokens       — device push notification tokens
```

All tables have Row Level Security (RLS) enabled.

## License

Private project. TVMaze data used under their free API terms.
