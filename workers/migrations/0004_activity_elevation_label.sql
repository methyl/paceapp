-- Persist workout label and elevation aggregates on the activities row so
-- MCP list_activities and similar metadata-only endpoints can return them
-- without reading the parsed JSON blob from R2.

ALTER TABLE activities ADD COLUMN workout_label TEXT;
ALTER TABLE activities ADD COLUMN total_ascent REAL;
ALTER TABLE activities ADD COLUMN total_descent REAL;
