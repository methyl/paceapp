-- Initial schema for PaceApp backend.
-- Tables: users, magic_tokens (one-time login codes), sessions, activities.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE magic_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX idx_magic_tokens_email ON magic_tokens(email);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- One row per imported FIT file.
-- file_name is unique per user so re-upload of the same file updates in place.
CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  start_time TEXT,
  sport TEXT,
  workout_type TEXT,
  total_distance REAL,
  total_elapsed_time REAL,
  fit_r2_key TEXT,
  json_r2_key TEXT,
  fit_size INTEGER,
  json_size INTEGER,
  uploaded_at INTEGER NOT NULL,
  UNIQUE(user_id, file_name)
);
CREATE INDEX idx_activities_user_start ON activities(user_id, start_time DESC);
