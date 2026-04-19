import type { Env } from "../env";
import { json, error } from "../http";
import { randomToken, sha256Hex } from "../crypto";
import { sessionCookie, clearSessionCookie, parseCookies } from "../cookies";
import { SESSION_COOKIE } from "../cookies";
import { sendMagicLinkEmail } from "../email";
import { getUserFromRequest } from "../auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestMagicLink(req: Request, env: Env): Promise<Response> {
  const body = await safeJson(req);
  const email = normalizeEmail(body?.email);
  if (!email || !EMAIL_RE.test(email)) return error(400, "invalid email");

  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(env.MAGIC_TTL_SECONDS) || 900;
  const expiresAt = now + ttl;

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);

  await env.DB.prepare(
    "INSERT INTO magic_tokens (token_hash, email, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(tokenHash, email, now, expiresAt)
    .run();

  const link = buildMagicLink(env.APP_URL, token, email);

  // Dev escape hatch: return the link in the response instead of emailing.
  if (env.DEV_RETURN_MAGIC_LINK === "true") {
    console.log(`[dev magic link for ${email}] ${link}`);
    return json({ ok: true, devLink: link });
  }

  try {
    await sendMagicLinkEmail(env, email, link);
  } catch {
    return error(502, "failed to send email");
  }
  return json({ ok: true });
}

export async function verifyMagicLink(req: Request, env: Env): Promise<Response> {
  const body = await safeJson(req);
  const token: string | undefined = body?.token;
  if (!token || typeof token !== "string") return error(400, "missing token");

  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);

  const row = await env.DB.prepare(
    "SELECT email, expires_at, consumed_at FROM magic_tokens WHERE token_hash = ?1",
  )
    .bind(tokenHash)
    .first<{ email: string; expires_at: number; consumed_at: number | null }>();

  if (!row) return error(400, "invalid or expired link");
  if (row.consumed_at) return error(400, "link already used");
  if (row.expires_at < now) return error(400, "link expired");

  await env.DB.prepare("UPDATE magic_tokens SET consumed_at = ?1 WHERE token_hash = ?2")
    .bind(now, tokenHash)
    .run();

  const email = row.email;

  let user = await env.DB.prepare("SELECT id, email FROM users WHERE email = ?1")
    .bind(email)
    .first<{ id: string; email: string }>();

  if (!user) {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3)")
      .bind(id, email, now)
      .run();
    user = { id, email };
  }

  const sessionToken = randomToken(32);
  const sessionHash = await sha256Hex(sessionToken);
  const sessionTtl = Number(env.SESSION_TTL_SECONDS) || 30 * 24 * 3600;
  const expires = now + sessionTtl;

  await env.DB.prepare(
    "INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?3)",
  )
    .bind(sessionHash, user.id, now, expires)
    .run();

  const url = new URL(req.url);
  const secure = url.protocol === "https:";
  const cookie = sessionCookie(sessionToken, sessionTtl, env.COOKIE_DOMAIN, secure);
  return json(
    { ok: true, user: { id: user.id, email: user.email } },
    { headers: { "set-cookie": cookie } },
  );
}

export async function logout(req: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(req.headers.get("cookie"));
  const token = cookies[SESSION_COOKIE];
  if (token) {
    const idHash = await sha256Hex(token);
    await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?1").bind(idHash).run();
  }
  const url = new URL(req.url);
  const secure = url.protocol === "https:";
  return json(
    { ok: true },
    { headers: { "set-cookie": clearSessionCookie(env.COOKIE_DOMAIN, secure) } },
  );
}

export async function me(req: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(req, env);
  if (!user) return json({ user: null });
  return json({ user });
}

function buildMagicLink(appUrl: string, token: string, email: string): string {
  const u = new URL(appUrl);
  u.searchParams.set("magic", token);
  u.searchParams.set("email", email);
  return u.toString();
}

function normalizeEmail(e: unknown): string | null {
  if (typeof e !== "string") return null;
  return e.trim().toLowerCase();
}

async function safeJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
