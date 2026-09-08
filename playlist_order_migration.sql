-- Lets an admin control the order tracks appear in within a playlist
-- (drag-and-drop in /admin/playlist), reflected on the public playlist page.

ALTER TABLE playlisttracks ADD COLUMN priority INT NOT NULL DEFAULT 0;

-- Backfill: use the existing added_at order as the starting sequence, so
-- the first time the admin opens the reorder UI, tracks aren't in an
-- arbitrary order - they start out matching whatever order they were
-- originally added in.
UPDATE playlisttracks pt
JOIN (
	SELECT playlist_id, track_id,
	       ROW_NUMBER() OVER (PARTITION BY playlist_id ORDER BY added_at) AS rn
	FROM playlisttracks
) ranked ON pt.playlist_id = ranked.playlist_id AND pt.track_id = ranked.track_id
SET pt.priority = ranked.rn;
