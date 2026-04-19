-- OAuth 2.0 provider tables so ChatGPT and other remote MCP clients can
-- authenticate via the standard auth-code + PKCE flow. Bearer tokens
-- minted manually via api_tokens continue to work in parallel.

CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,              -- client_id (UUID)
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,      -- JSON array
  created_at INTEGER NOT NULL
);

CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT,
  code_challenge_method TEXT,
  scope TEXT,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY,
  access_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX idx_oauth_tokens_user ON oauth_tokens(user_id);

-- Let magic links optionally carry a post-verification redirect URL so
-- the OAuth authorize flow can bounce unauthed users through sign-in.
ALTER TABLE magic_tokens ADD COLUMN return_url TEXT;
