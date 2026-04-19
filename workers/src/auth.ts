import type { Env } from "./env";
import { SESSION_COOKIE, parseCookies } from "./cookies";
import { sha256Hex } from "./crypto";

export interface User {
  id: string;
  email: string;
}

export async function getUserFromRequest(req: Request, env: Env): Promise<User | null> {
  const cookies = parseCookies(req.headers.get("cookie"));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const idHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);

  const row = await env.DB.prepare(
    `SELECT u.id AS id, u.email AS email, s.expires_at AS expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ?1`,
  )
    .bind(idHash)
    .first<{ id: string; email: string; expires_at: number }>();

  if (!row) return null;
  if (row.expires_at < now) {
    await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?1").bind(idHash).run();
    return null;
  }

  // Sliding last_seen (fire-and-forget).
  env.DB.prepare("UPDATE sessions SET last_seen_at = ?1 WHERE id_hash = ?2")
    .bind(now, idHash)
    .run()
    .catch(() => {});

  return { id: row.id, email: row.email };
}
