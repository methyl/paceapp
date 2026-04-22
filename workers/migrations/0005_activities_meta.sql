-- Single JSON bag for metadata we extract from the parsed activity JSON.
-- Anything that isn't filtered / sorted in SQL (workoutLabel, totalAscent,
-- totalDescent, etc.) lives here so we never have to migrate the schema
-- again when a new field is added. The per-field columns from 0004 stay
-- for now — prod already has them populated and removing them would be a
-- separate cleanup.
ALTER TABLE activities ADD COLUMN meta TEXT;
