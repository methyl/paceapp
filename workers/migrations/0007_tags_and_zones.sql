-- Multi-tag workout classification + user-configurable HR zones.
--
-- activity_tags replaces the single-valued workout_type column with a
-- normalized table so a run can carry multiple tags at once (e.g. a
-- progressive tempo that was also hilly gets tagged [progressive, tempo,
-- hilly]). The old workout_type column stays populated for one release
-- so legacy callers keep working; it gets dropped in a follow-up
-- migration once activity_tags is the source of truth everywhere.

CREATE TABLE activity_tags (
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (activity_id, tag)
);
CREATE INDEX idx_activity_tags_tag ON activity_tags(tag);

-- Seed the new table from existing workout_type values so the chip row
-- keeps showing counts immediately after deploy. Rows whose workout_type
-- is NULL or 'unknown' land in activity_tags as 'other'. The backfill
-- worker will overwrite these with the full multi-tag set once
-- META_VERSION bumps.
INSERT INTO activity_tags (activity_id, tag)
SELECT id,
  CASE
    WHEN workout_type IS NULL OR workout_type = '' OR workout_type = 'unknown' THEN 'other'
    ELSE workout_type
  END
FROM activities;

-- Nullable JSON column holding the user's HR zone boundaries. NULL means
-- "auto-derive from the user's activities" (via LTHR estimate, falling
-- back to observed HRmax).
ALTER TABLE users ADD COLUMN hr_zones TEXT;
