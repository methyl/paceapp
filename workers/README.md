# PaceApp Worker

Cloudflare Worker backend for PaceApp: magic-link email auth, D1 for user/activity
metadata, R2 for raw .fit bytes and parsed JSON.

## First-time setup

```bash
cd workers
npm install

# 1. Create the D1 database; copy the returned database_id into wrangler.toml.
npx wrangler d1 create paceapp

# 2. Create the R2 bucket.
npx wrangler r2 bucket create paceapp-fit

# 3. Set a random 32+ byte session secret.
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET

# 4. Apply migrations to remote D1.
npm run db:migrate:remote

# 5. (Production) configure the Cloudflare Email Service sender domain in the
#    dashboard and update MAGIC_FROM in wrangler.toml to a verified address.

# 6. Deploy.
npm run deploy
```

## Local dev

```bash
# In workers/:
npm run db:migrate:local
npx wrangler dev
# Worker listens on http://127.0.0.1:8787

# In the project root, in another terminal:
npm run dev
# Vite proxies /api → http://127.0.0.1:8787
```

In local dev the Email binding may not be configured. Set
`DEV_RETURN_MAGIC_LINK = "true"` in `wrangler.toml` `[vars]` so that
`POST /api/auth/request` returns the magic link in the JSON response — the
frontend `AuthBar` renders it as a clickable "(dev) open link".

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | ping |
| POST | `/api/auth/request` | body `{ email }` — send magic link |
| POST | `/api/auth/verify` | body `{ token }` — exchange magic token for a session cookie |
| GET  | `/api/auth/me` | current user from cookie |
| POST | `/api/auth/logout` | end session |
| GET  | `/api/activities` | list signed-in user's activities (metadata only) |
| POST | `/api/activities` | multipart upload: `fileName`, `fit` (blob), `parsed` (JSON blob) |
| GET  | `/api/activities/:id/fit`  | download original .fit |
| GET  | `/api/activities/:id/json` | download parsed JSON |
| DELETE | `/api/activities/:id` | remove D1 row + both R2 objects |

## Data model

- **users**: id, email (unique), created_at
- **magic_tokens**: token_hash, email, created_at, expires_at, consumed_at (one-time use, 15 min TTL)
- **sessions**: id_hash (sha256 of random cookie token), user_id, created_at, expires_at, last_seen_at (sliding)
- **activities**: id, user_id, file_name (unique per user), start_time, sport, workout_type, total_distance, total_elapsed_time, fit_r2_key, json_r2_key, fit_size, json_size, uploaded_at

R2 key layout: `users/{user_id}/fit/{activity_id}.fit` and `users/{user_id}/json/{activity_id}.json`.
