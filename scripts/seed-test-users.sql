-- ============================================================================
-- Seed Test Users for Cliffhanger Mobile
-- Run this in Supabase SQL Editor
--
-- Creates 5 test users with profiles and watchlists.
-- They all have password: testpass123
--
-- After running, you can send friend requests to them from your account
-- by searching their usernames in the Friends screen.
-- ============================================================================

-- Create test users in auth.users
-- Using Supabase's auth.users table directly with pre-hashed password
-- Password for all: testpass123

INSERT INTO auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, aud, role
) VALUES
  (
    'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
    '00000000-0000-0000-0000-000000000000',
    'alice@test.com',
    crypt('testpass123', gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"display_name": "Alice Chen", "username": "alicechen"}',
    now(), now(), '', 'authenticated', 'authenticated'
  ),
  (
    'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
    '00000000-0000-0000-0000-000000000000',
    'bob@test.com',
    crypt('testpass123', gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"display_name": "Bob Martinez", "username": "bobm"}',
    now(), now(), '', 'authenticated', 'authenticated'
  ),
  (
    'cccccccc-3333-3333-3333-cccccccccccc',
    '00000000-0000-0000-0000-000000000000',
    'charlie@test.com',
    crypt('testpass123', gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"display_name": "Charlie Park", "username": "charliepark"}',
    now(), now(), '', 'authenticated', 'authenticated'
  ),
  (
    'dddddddd-4444-4444-4444-dddddddddddd',
    '00000000-0000-0000-0000-000000000000',
    'dana@test.com',
    crypt('testpass123', gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"display_name": "Dana Rivera", "username": "danar"}',
    now(), now(), '', 'authenticated', 'authenticated'
  ),
  (
    'eeeeeeee-5555-5555-5555-eeeeeeeeeeee',
    '00000000-0000-0000-0000-000000000000',
    'emma@test.com',
    crypt('testpass123', gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"display_name": "Emma Wong", "username": "emmaw"}',
    now(), now(), '', 'authenticated', 'authenticated'
  )
ON CONFLICT (id) DO NOTHING;

-- Create identities (required for Supabase auth to work)
INSERT INTO auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
) VALUES
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'alice@test.com', 'email', '{"sub": "aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa", "email": "alice@test.com"}', now(), now(), now()),
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', 'bob@test.com', 'email', '{"sub": "bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb", "email": "bob@test.com"}', now(), now(), now()),
  ('cccccccc-3333-3333-3333-cccccccccccc', 'cccccccc-3333-3333-3333-cccccccccccc', 'charlie@test.com', 'email', '{"sub": "cccccccc-3333-3333-3333-cccccccccccc", "email": "charlie@test.com"}', now(), now(), now()),
  ('dddddddd-4444-4444-4444-dddddddddddd', 'dddddddd-4444-4444-4444-dddddddddddd', 'dana@test.com', 'email', '{"sub": "dddddddd-4444-4444-4444-dddddddddddd", "email": "dana@test.com"}', now(), now(), now()),
  ('eeeeeeee-5555-5555-5555-eeeeeeeeeeee', 'eeeeeeee-5555-5555-5555-eeeeeeeeeeee', 'emma@test.com', 'email', '{"sub": "eeeeeeee-5555-5555-5555-eeeeeeeeeeee", "email": "emma@test.com"}', now(), now(), now())
ON CONFLICT DO NOTHING;

-- Profiles should be auto-created by the trigger, but insert manually in case
INSERT INTO public.profiles (id, display_name, username) VALUES
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'Alice Chen', 'alicechen'),
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', 'Bob Martinez', 'bobm'),
  ('cccccccc-3333-3333-3333-cccccccccccc', 'Charlie Park', 'charliepark'),
  ('dddddddd-4444-4444-4444-dddddddddddd', 'Dana Rivera', 'danar'),
  ('eeeeeeee-5555-5555-5555-eeeeeeeeeeee', 'Emma Wong', 'emmaw')
ON CONFLICT (id) DO NOTHING;

-- ─── Watchlists ─────────────────────────────────────────────────────────────
-- TVMaze show IDs: Breaking Bad=169, The Pitt=77498, Invincible=44047,
-- Severance=41587, The Bear=55714, Andor=58558, Shogun=728,
-- The Last of Us=46562, House of the Dragon=41428, Yellowjackets=46558

-- Alice: big TV watcher, mix of everything
INSERT INTO public.user_shows (user_id, show_id, status, show_title, show_image, show_network, current_season, current_episode, current_episode_airdate) VALUES
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', '169', 'watched', 'Breaking Bad', 'https://static.tvmaze.com/uploads/images/medium_portrait/501/1253519.jpg', 'AMC', 5, 16, '2013-09-29'),
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', '44047', 'currently_watching', 'Invincible', 'https://static.tvmaze.com/uploads/images/medium_portrait/501/1253051.jpg', 'Amazon Prime Video', 2, 4, '2024-01-04'),
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', '41587', 'currently_watching', 'Severance', 'https://static.tvmaze.com/uploads/images/medium_portrait/499/1249732.jpg', 'Apple TV+', 2, 7, '2025-03-05'),
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', '46562', 'want_to_watch', 'The Last of Us', 'https://static.tvmaze.com/uploads/images/medium_portrait/473/1182507.jpg', 'HBO', 0, 0, NULL)
ON CONFLICT DO NOTHING;

-- Bob: mostly wants to watch stuff
INSERT INTO public.user_shows (user_id, show_id, status, show_title, show_image, show_network, current_season, current_episode, current_episode_airdate) VALUES
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', '169', 'currently_watching', 'Breaking Bad', 'https://static.tvmaze.com/uploads/images/medium_portrait/501/1253519.jpg', 'AMC', 3, 8, '2010-06-13'),
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', '55714', 'want_to_watch', 'The Bear', 'https://static.tvmaze.com/uploads/images/medium_portrait/476/1191753.jpg', 'Hulu', 0, 0, NULL),
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', '41428', 'want_to_watch', 'House of the Dragon', 'https://static.tvmaze.com/uploads/images/medium_portrait/476/1191579.jpg', 'HBO', 0, 0, NULL)
ON CONFLICT DO NOTHING;

-- Charlie: caught up on everything
INSERT INTO public.user_shows (user_id, show_id, status, show_title, show_image, show_network, current_season, current_episode, current_episode_airdate) VALUES
  ('cccccccc-3333-3333-3333-cccccccccccc', '169', 'watched', 'Breaking Bad', 'https://static.tvmaze.com/uploads/images/medium_portrait/501/1253519.jpg', 'AMC', 5, 16, '2013-09-29'),
  ('cccccccc-3333-3333-3333-cccccccccccc', '41587', 'watched', 'Severance', 'https://static.tvmaze.com/uploads/images/medium_portrait/499/1249732.jpg', 'Apple TV+', 2, 10, '2025-03-26'),
  ('cccccccc-3333-3333-3333-cccccccccccc', '55714', 'watched', 'The Bear', 'https://static.tvmaze.com/uploads/images/medium_portrait/476/1191753.jpg', 'Hulu', 3, 10, '2024-07-17'),
  ('cccccccc-3333-3333-3333-cccccccccccc', '44047', 'currently_watching', 'Invincible', 'https://static.tvmaze.com/uploads/images/medium_portrait/501/1253051.jpg', 'Amazon Prime Video', 2, 8, '2024-04-04'),
  ('cccccccc-3333-3333-3333-cccccccccccc', '77498', 'currently_watching', 'The Pitt', NULL, 'CBS', 1, 10, '2025-03-20')
ON CONFLICT DO NOTHING;

-- Dana: just getting started
INSERT INTO public.user_shows (user_id, show_id, status, show_title, show_image, show_network, current_season, current_episode, current_episode_airdate) VALUES
  ('dddddddd-4444-4444-4444-dddddddddddd', '41587', 'currently_watching', 'Severance', 'https://static.tvmaze.com/uploads/images/medium_portrait/499/1249732.jpg', 'Apple TV+', 1, 3, '2022-02-25'),
  ('dddddddd-4444-4444-4444-dddddddddddd', '169', 'want_to_watch', 'Breaking Bad', 'https://static.tvmaze.com/uploads/images/medium_portrait/501/1253519.jpg', 'AMC', 0, 0, NULL)
ON CONFLICT DO NOTHING;

-- Emma: active watcher
INSERT INTO public.user_shows (user_id, show_id, status, show_title, show_image, show_network, current_season, current_episode, current_episode_airdate) VALUES
  ('eeeeeeee-5555-5555-5555-eeeeeeeeeeee', '169', 'watched', 'Breaking Bad', 'https://static.tvmaze.com/uploads/images/medium_portrait/501/1253519.jpg', 'AMC', 5, 16, '2013-09-29'),
  ('eeeeeeee-5555-5555-5555-eeeeeeeeeeee', '77498', 'currently_watching', 'The Pitt', NULL, 'CBS', 1, 5, '2025-02-13'),
  ('eeeeeeee-5555-5555-5555-eeeeeeeeeeee', '44047', 'currently_watching', 'Invincible', 'https://static.tvmaze.com/uploads/images/medium_portrait/501/1253051.jpg', 'Amazon Prime Video', 1, 8, '2021-04-30'),
  ('eeeeeeee-5555-5555-5555-eeeeeeeeeeee', '41587', 'want_to_watch', 'Severance', 'https://static.tvmaze.com/uploads/images/medium_portrait/499/1249732.jpg', 'Apple TV+', 0, 0, NULL),
  ('eeeeeeee-5555-5555-5555-eeeeeeeeeeee', '55714', 'want_to_watch', 'The Bear', 'https://static.tvmaze.com/uploads/images/medium_portrait/476/1191753.jpg', 'Hulu', 0, 0, NULL)
ON CONFLICT DO NOTHING;

-- ─── Pre-made friendships between test users ────────────────────────────────
-- Alice & Charlie are friends, Bob sent Alice a pending request

INSERT INTO public.friendships (user_id, friend_id, status) VALUES
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'cccccccc-3333-3333-3333-cccccccccccc', 'accepted'),
  ('eeeeeeee-5555-5555-5555-eeeeeeeeeeee', 'cccccccc-3333-3333-3333-cccccccccccc', 'accepted'),
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'pending')
ON CONFLICT DO NOTHING;
