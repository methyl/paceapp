-- Promote the meta schema version out of the JSON blob into a proper column
-- so the backfill sweep (workers/meta-backfill) can identify stale rows with
-- an indexed `WHERE meta_version < ?` instead of json_extract over every row.
ALTER TABLE activities ADD COLUMN meta_version INTEGER;
CREATE INDEX idx_activities_meta_version ON activities(meta_version);
