-- Per-user toggle for friend-request push notifications. Mirrors the existing
-- push_chat_messages and push_new_episodes flags. Default ON so existing
-- users immediately get pushes the first time someone friends them after
-- this ships; they can opt out from Settings.

ALTER TABLE profiles
  ADD COLUMN push_friend_requests boolean NOT NULL DEFAULT true;
