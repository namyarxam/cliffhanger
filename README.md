# Cliffhanger

A social TV show tracking app. Track what you're watching, see where your friends are in a show, and chat about episodes without spoilers.

Built with [Expo](https://expo.dev) (React Native), [Supabase](https://supabase.com), and the [TVMaze API](https://www.tvmaze.com/api).

## Features

### Show discovery
- Live search powered by TVMaze API — type a show name, instant results
- Show detail pages with poster, network, genre, season/episode counts, cast
- "Airing" badge on currently active shows; upcoming-episode info with air dates

### Watchlists & episode tracking
- Three-list system: **Watchlist**, **Currently Watching**, **Finished**
- One-tap status switching; re-tap removes (episode progress preserved)
- **Visual episode timeline** — horizontal scrollable strip of color-coded dots, grouped by season
- One-tap catch-up: tap any episode and everything before it (across seasons) marks as watched
- Future episodes are dimmed and non-selectable; latest-aired ringed in red

### Smart sub-grouping on the My Shows tab
- "Currently Watching" auto-splits into **Behind / Returning / On Hiatus / Series Ended** based on TVMaze status + cached next-airdate
- Behind shows surface a "NEW S? E? ✓" CTA that advances one episode per tap
- Multi-behind shows get a "Catch up · N" pill that opens a bottom sheet of every unwatched episode (title, image, summary) — tap any to mark-up-to that point with no gaps
- Returning shows show their next airdate; Series Ended shows get a soft "Done? ✓" nudge to finalize

### Friends
- Username search; send / accept / decline friend requests; mutual requests auto-accept
- View any friend's watchlist; see who else is watching a given show, with their progress
- Pending-request badge on the Profile tab

### Unified chat with spoiler lock
- DMs and group chats are the same entity — start a chat with anyone, optionally name it, optionally attach a show
- **Spoiler lock**: when a show is attached, members behind on episodes can't see the chat until they catch up
- Real-time messages via Supabase Broadcast; GIF support via Giphy
- Friend-based invites (no codes); pending invite badges on the Chat tab

### Notifications
- Supabase Edge Function polls TVMaze schedule every 3 hours; new episodes appear in your "Behind" group automatically
- Per-show bell toggle for episode-aired push notifications
- Master push toggle + "alert for all currently watching" override in Settings

### Polish
- Dark theme throughout; DM Sans typography; haptic feedback on key actions
- Profile customization (display name, username, avatar character)
- Block / report users; account deletion
- Sentry crash reporting; password reset + email verification deep links

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Expo (React Native), TypeScript, expo-router |
| Backend | Supabase (Postgres, Auth, Realtime/Broadcast, Edge Functions) |
| Data | TVMaze API (live search, show data, schedule); Giphy API (chat GIFs) |
| Auth | Supabase Auth (email/password) with deep-link confirmation flow |
| Chat | Supabase Broadcast for instant message delivery |
| Notifications | expo-notifications, Expo Push Service |
| Distribution | EAS Build, TestFlight |
| Monitoring | Sentry (error reporting + user context) |
| Styling | StyleSheet.create(), custom dark theme, DM Sans font |

## Getting started

### Prerequisites
- Node.js 18+
- [Expo Go](https://expo.dev/go) on your phone, or Xcode for the iOS simulator
- A [Supabase](https://supabase.com) project

### Setup

```bash
git clone git@github.com:namyarxam/cliffhanger.git
cd cliffhanger
npm install
```

Create a `.env` with your Supabase + Sentry credentials:

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_SENTRY_DSN=your-sentry-dsn
EXPO_PUBLIC_GIPHY_API_KEY=your-giphy-key
```

Apply the database migrations in `supabase/migrations/` (in numeric order) via the Supabase SQL Editor — 50+ files covering schema, RLS policies, and stored functions.

Run the dev server:

```bash
npx expo start
```

Scan the QR code with Expo Go.

### Optional: deploy the schedule Edge Function

```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref your-project-ref
supabase functions deploy poll-schedule
```

Schedule it to run every 3 hours via pg_cron or an external cron service.

## Architecture highlights

- **TVMaze metadata cached on `user_shows`** (status, next-airdate, last-aired episode + airdate) so the My Shows tab can sub-group rows by airing state without N round-trips per render. Cache populates lazily when the user opens any show detail page.
- **"Behind" detection has two signals**: the schedule-cron table (eager) and the cached last-aired episode (reliable fallback) — the My Shows list self-heals from a missed cron poll on the user's next show-page visit.
- **Unified conversation model**: DMs and group chats are a single table. A conversation with 2 members and no show is a DM; everything else is a group chat. Auto-naming from member names when no explicit name is set, like iMessage.
- **Spoiler lock**: when a show is attached to a conversation, the chat is gated on each member's episode progress — members behind the show's "front-runner" see a locked screen until they catch up, then it opens instantly.
- **All tables use Row Level Security**; the public-readable surface is intentionally minimal (profiles, watchlists for the friend-discovery use case).

## Status

Live on the App Store since April 2026. v1.0.1 in progress.

## License

[MIT](LICENSE).

## Acknowledgments

Show data from [TVMaze](https://www.tvmaze.com/api), used under their CC BY-SA license. GIF search via [Giphy](https://developers.giphy.com).
