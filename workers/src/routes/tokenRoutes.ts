import type { Env } from "../env";
import { json, error } from "../http";
import { getUserFromRequest } from "../auth";
import { randomToken, sha256Hex } from "../crypto";

const TOKEN_PREFIX = "pcapp_";
const MAX_TOKENS_PER_USER = 20;

interface TokenRow {
  id: string;
  label: string | null;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
}

export async function listTokens(req: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(req, env);
  if (!user) return error(401, "not authenticated");

  const { results } = await env.DB.prepare(
    `SELECT id, label, prefix, created_at, last_used_at
     FROM api_tokens
     WHERE user_id = ?1
     ORDER BY created_at DESC`,
  )
    .bind(user.id)
    .all<TokenRow>();

  return json({
    tokens: (results ?? []).map((r) => ({
      id: r.id,
      label: r.label,
      prefix: r.prefix,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    })),
  });
}

export async function createToken(req: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(req, env);
  if (!user) return error(401, "not authenticated");

  let body: { label?: unknown };
  try {
    body = await req.json();
  } catch {
    return error(400, "invalid json");
  }
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 64) : "";

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM api_tokens WHERE user_id = ?1",
  )
    .bind(user.id)
    .first<{ c: number }>();
  if ((countRow?.c ?? 0) >= MAX_TOKENS_PER_USER) {
    return error(429, `token limit reached (${MAX_TOKENS_PER_USER})`);
  }

  const secret = randomToken(32);
  const token = TOKEN_PREFIX + secret;
  const tokenHash = await sha256Hex(token);
  const prefix = secret.slice(0, 6);
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO api_tokens (id, token_hash, user_id, label, prefix, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(id, tokenHash, user.id, label || null, prefix, now)
    .run();

  return json({
    id,
    token,
    label: label || null,
    prefix,
    createdAt: now,
  });
}

export async function revokeToken(req: Request, env: Env, id: string): Promise<Response> {
  const user = await getUserFromRequest(req, env);
  if (!user) return error(401, "not authenticated");

  const res = await env.DB.prepare(
    "DELETE FROM api_tokens WHERE id = ?1 AND user_id = ?2",
  )
    .bind(id, user.id)
    .run();

  if (!res.meta.changes) return error(404, "not found");
  return json({ ok: true });
}

/**
 * Resolve a user from an `Authorization: Bearer ...` header. Used by the MCP
 * endpoint. Returns null if the header is missing, malformed, or unknown.
 */
export async function getUserFromBearer(req: Request, env: Env) {
  const auth = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) return null;
  const token = m[1];
  if (!token.startsWith(TOKEN_PREFIX)) return null;

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id AS id, u.email AS email, t.id AS token_id
     FROM api_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?1`,
  )
    .bind(tokenHash)
    .first<{ id: string; email: string; token_id: string }>();

  if (!row) return null;

  const now = Math.floor(Date.now() / 1000);
  env.DB.prepare("UPDATE api_tokens SET last_used_at = ?1 WHERE id = ?2")
    .bind(now, row.token_id)
    .run()
    .catch(() => {});

  return { id: row.id, email: row.email };
}
