-- Drop the per-field columns added by 0004 that were superseded by the
-- single `meta` JSON column + `meta_version` scheme (0005, 0006). No code
-- reads these anymore: the upload path, MCP tools, and meta-backfill Worker
-- all source workout label and elevation aggregates from `meta`. The one
-- row in prod that briefly had `workout_label` populated (during the window
-- between PR #14 and PR #15) already has that value mirrored into `meta`,
-- so nothing useful is lost here.
ALTER TABLE activities DROP COLUMN workout_label;
ALTER TABLE activities DROP COLUMN total_ascent;
ALTER TABLE activities DROP COLUMN total_descent;
