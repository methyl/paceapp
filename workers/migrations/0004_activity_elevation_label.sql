-- Single JSON bag for metadata we extract from the parsed activity JSON.
-- Anything that isn't filtered / sorted in SQL (workoutLabel, totalAscent,
-- totalDescent, etc.) lives here so we never have to migrate the schema
-- again when a new field is added.
ALTER TABLE activities ADD COLUMN meta TEXT;
