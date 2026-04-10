-- Utility: Make all current users friends with each other
-- Run manually in Supabase SQL Editor when adding new testers
-- Safe to re-run — skips existing friendships

INSERT INTO friendships (user_id, friend_id, status)
SELECT a.id, b.id, 'accepted'
FROM profiles a
CROSS JOIN profiles b
WHERE a.id < b.id
  AND NOT EXISTS (
    SELECT 1 FROM friendships f
    WHERE (f.user_id = a.id AND f.friend_id = b.id)
       OR (f.user_id = b.id AND f.friend_id = a.id)
  );
