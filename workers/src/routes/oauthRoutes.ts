import type { Env } from "../env";
import { json, error } from "../http";
import { randomToken, sha256Hex, timingSafeEqual } from "../crypto";
import { getUserFromRequest } from "../auth";
import { sendMagicLinkEmail } from "../email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_TTL_SECONDS = 600;                // auth code lifetime
const TOKEN_TTL_SECONDS = 30 * 24 * 3600;    // access token lifetime

function issuer(env: Env): string {
  return env.APP_URL.replace(/\/+$/, "");
}

// ---------- discovery ----------

export function discovery(_req: Request, env: Env): Response {
  const base = issuer(env);
  return json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  });
}

export function protectedResource(_req: Request, env: Env): Response {
  const base = issuer(env);
  return json({
    resource: base,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  });
}

// ---------- dynamic client registration (RFC 7591) ----------

export async function register(req: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return error(400, "invalid json");
  }

  const name =
    typeof body.client_name === "string" ? body.client_name.slice(0, 128) : "MCP client";
  const redirectUris = Array.isArray(body.redirect_uris)
    ? (body.redirect_uris as unknown[]).filter((u): u is string => typeof u === "string").slice(0, 10)
    : [];
  if (redirectUris.length === 0) return error(400, "redirect_uris required");

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO oauth_clients (id, name, redirect_uris, created_at)
     VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(id, name, JSON.stringify(redirectUris), now)
    .run();

  return json(
    {
      client_id: id,
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
    { status: 201 },
  );
}

// ---------- authorize ----------

interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  state: string | null;
  scope: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
}

function readAuthorizeParams(url: URL): AuthorizeParams | null {
  const p = url.searchParams;
  const client_id = p.get("client_id");
  const redirect_uri = p.get("redirect_uri");
  const response_type = p.get("response_type");
  if (!client_id || !redirect_uri || !response_type) return null;
  return {
    client_id,
    redirect_uri,
    response_type,
    state: p.get("state"),
    scope: p.get("scope"),
    code_challenge: p.get("code_challenge"),
    code_challenge_method: p.get("code_challenge_method") ?? "plain",
  };
}

export async function authorizeGet(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const params = readAuthorizeParams(url);
  if (!params) return htmlError("Missing required OAuth parameters.");
  if (params.response_type !== "code") return htmlError("Only response_type=code is supported.");

  const client = await loadClient(env, params.client_id);
  if (!client) return htmlError("Unknown client_id.");
  if (!clientAllowsRedirect(client, params.redirect_uri))
    return htmlError("redirect_uri not registered for this client.");

  const user = await getUserFromRequest(req, env);
  if (!user) return renderSignInPage(url);
  return renderConsentPage(client.name, user.email, url);
}

export async function authorizePost(req: Request, env: Env): Promise<Response> {
  const form = await req.formData().catch(() => null);
  if (!form) return htmlError("Invalid form submission.");

  // The consent form posts with ?<authorize params> preserved in the URL.
  const url = new URL(req.url);
  const params = readAuthorizeParams(url);
  if (!params) return htmlError("Missing required OAuth parameters.");

  const client = await loadClient(env, params.client_id);
  if (!client || !clientAllowsRedirect(client, params.redirect_uri)) {
    return htmlError("Invalid client or redirect_uri.");
  }

  const user = await getUserFromRequest(req, env);
  if (!user) return htmlError("Sign-in expired. Please restart from your client.");

  if (form.get("action") !== "approve") {
    return redirectBack(params.redirect_uri, {
      error: "access_denied",
      state: params.state,
    });
  }

  const code = randomToken(32);
  const codeHash = await sha256Hex(code);
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO oauth_codes
       (code_hash, client_id, user_id, redirect_uri, code_challenge,
        code_challenge_method, scope, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      codeHash,
      params.client_id,
      user.id,
      params.redirect_uri,
      params.code_challenge,
      params.code_challenge_method,
      params.scope,
      now + CODE_TTL_SECONDS,
    )
    .run();

  return redirectBack(params.redirect_uri, { code, state: params.state });
}

// ---------- sign-in from consent page ----------

export async function signin(req: Request, env: Env): Promise<Response> {
  const form = await req.formData().catch(() => null);
  if (!form) return htmlError("Invalid form.");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const returnUrl = String(form.get("return_url") ?? "");
  if (!EMAIL_RE.test(email)) return htmlError("Invalid email address.");
  if (!returnUrl.startsWith("/oauth/authorize")) return htmlError("Invalid return_url.");

  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(env.MAGIC_TTL_SECONDS) || 900;
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);

  await env.DB.prepare(
    `INSERT INTO magic_tokens (token_hash, email, created_at, expires_at, return_url)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(tokenHash, email, now, now + ttl, returnUrl)
    .run();

  const base = issuer(env);
  const link = `${base}/api/auth/verify?token=${encodeURIComponent(token)}`;

  if (env.DEV_RETURN_MAGIC_LINK === "true") {
    console.log(`[dev magic link for ${email}] ${link}`);
  } else {
    try {
      await sendMagicLinkEmail(env, email, link);
    } catch {
      return htmlError("Failed to send email. Try again later.");
    }
  }

  return html(`
    <h1>Check your email</h1>
    <p>We sent a sign-in link to <strong>${escapeHtml(email)}</strong>.</p>
    <p>Open it on this device to continue the authorization.</p>
  `);
}

// ---------- token exchange ----------

export async function token(req: Request, env: Env): Promise<Response> {
  const ct = req.headers.get("content-type") || "";
  let params: Record<string, string>;
  if (ct.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    params = {};
    for (const [k, v] of form) params[k] = String(v);
  } else if (ct.includes("application/json")) {
    params = (await req.json().catch(() => ({}))) as Record<string, string>;
  } else {
    return tokenError("invalid_request", "content-type must be form or json");
  }

  if (params.grant_type !== "authorization_code") {
    return tokenError("unsupported_grant_type", "only authorization_code supported");
  }
  const code = params.code;
  const clientId = params.client_id;
  const redirectUri = params.redirect_uri;
  const verifier = params.code_verifier;
  if (!code || !clientId || !redirectUri) {
    return tokenError("invalid_request", "missing parameters");
  }

  const codeHash = await sha256Hex(code);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT client_id, user_id, redirect_uri, code_challenge, code_challenge_method,
            scope, expires_at, consumed_at
     FROM oauth_codes WHERE code_hash = ?1`,
  )
    .bind(codeHash)
    .first<{
      client_id: string;
      user_id: string;
      redirect_uri: string;
      code_challenge: string | null;
      code_challenge_method: string | null;
      scope: string | null;
      expires_at: number;
      consumed_at: number | null;
    }>();

  if (!row) return tokenError("invalid_grant", "unknown code");
  if (row.consumed_at) return tokenError("invalid_grant", "code already used");
  if (row.expires_at < now) return tokenError("invalid_grant", "code expired");
  if (row.client_id !== clientId) return tokenError("invalid_grant", "client mismatch");
  if (row.redirect_uri !== redirectUri) return tokenError("invalid_grant", "redirect mismatch");

  if (row.code_challenge) {
    if (!verifier) return tokenError("invalid_grant", "code_verifier required");
    const ok = await verifyPkce(
      verifier,
      row.code_challenge,
      row.code_challenge_method ?? "plain",
    );
    if (!ok) return tokenError("invalid_grant", "pkce mismatch");
  }

  await env.DB.prepare("UPDATE oauth_codes SET consumed_at = ?1 WHERE code_hash = ?2")
    .bind(now, codeHash)
    .run();

  const access = randomToken(32);
  const accessHash = await sha256Hex(access);
  const tokenId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO oauth_tokens
       (id, access_hash, client_id, user_id, scope, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      tokenId,
      accessHash,
      row.client_id,
      row.user_id,
      row.scope,
      now,
      now + TOKEN_TTL_SECONDS,
    )
    .run();

  return json({
    access_token: access,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
    scope: row.scope ?? "mcp",
  });
}

// ---------- helpers ----------

interface OAuthClient {
  id: string;
  name: string;
  redirect_uris: string[];
}

async function loadClient(env: Env, id: string): Promise<OAuthClient | null> {
  const row = await env.DB.prepare(
    "SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?1",
  )
    .bind(id)
    .first<{ id: string; name: string; redirect_uris: string }>();
  if (!row) return null;
  let uris: string[] = [];
  try {
    uris = JSON.parse(row.redirect_uris);
  } catch {}
  return { id: row.id, name: row.name, redirect_uris: uris };
}

function clientAllowsRedirect(client: OAuthClient, uri: string): boolean {
  return client.redirect_uris.some((u) => timingSafeEqual(u, uri));
}

async function verifyPkce(
  verifier: string,
  challenge: string,
  method: string,
): Promise<boolean> {
  if (method === "plain") return timingSafeEqual(verifier, challenge);
  if (method !== "S256") return false;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return timingSafeEqual(b64, challenge);
}

function tokenError(code: string, description: string): Response {
  return json(
    { error: code, error_description: description },
    { status: 400 },
  );
}

function redirectBack(base: string, params: Record<string, string | null | undefined>): Response {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) u.searchParams.set(k, v);
  }
  return new Response(null, { status: 302, headers: { location: u.toString() } });
}

function html(body: string, status = 200): Response {
  const doc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PaceApp</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 480px; margin: 4rem auto; padding: 0 1rem; color: #111; }
      h1 { font-size: 1.4rem; }
      input[type=email] { width: 100%; padding: 0.5rem; font-size: 1rem; border: 1px solid #ccc; border-radius: 4px; }
      button { padding: 0.5rem 1rem; font-size: 1rem; border: 0; border-radius: 4px; cursor: pointer; }
      .primary { background: #2563eb; color: #fff; }
      .secondary { background: #eee; color: #111; }
      form { display: grid; gap: 0.75rem; margin-top: 1rem; }
      .muted { color: #666; font-size: 0.85rem; }
      .row { display: flex; gap: 0.5rem; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
  return new Response(doc, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function htmlError(msg: string): Response {
  return html(`<h1>Authorization error</h1><p>${escapeHtml(msg)}</p>`, 400);
}

function renderSignInPage(authorizeUrl: URL): Response {
  const returnUrl = authorizeUrl.pathname + authorizeUrl.search;
  return html(`
    <h1>Sign in to authorize</h1>
    <p class="muted">A client is requesting access to your PaceApp data. Enter your email to sign in and review the request.</p>
    <form method="post" action="/oauth/signin">
      <input type="hidden" name="return_url" value="${escapeHtml(returnUrl)}">
      <input type="email" name="email" placeholder="you@example.com" required>
      <button type="submit" class="primary">Send magic link</button>
    </form>
  `);
}

function renderConsentPage(clientName: string, userEmail: string, authorizeUrl: URL): Response {
  const query = authorizeUrl.search;
  return html(`
    <h1>Authorize ${escapeHtml(clientName)}?</h1>
    <p><strong>${escapeHtml(clientName)}</strong> is asking to read your PaceApp data
       (activities, laps, segments) on behalf of <em>${escapeHtml(userEmail)}</em>.</p>
    <p class="muted">You can revoke access anytime from the MCP panel.</p>
    <form method="post" action="/oauth/authorize${query}">
      <div class="row">
        <button name="action" value="approve" class="primary">Allow</button>
        <button name="action" value="deny" class="secondary">Deny</button>
      </div>
    </form>
  `);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Resolve a user from an OAuth access token passed via Bearer header.
 * Returns null if missing/invalid. MCP endpoint uses this alongside
 * the manual pcapp_ bearer resolver.
 */
export async function getUserFromOAuthBearer(req: Request, env: Env) {
  const auth = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) return null;
  const accessHash = await sha256Hex(m[1]);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT u.id AS id, u.email AS email, t.id AS token_id, t.expires_at AS expires_at
     FROM oauth_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.access_hash = ?1`,
  )
    .bind(accessHash)
    .first<{ id: string; email: string; token_id: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < now) return null;

  env.DB.prepare("UPDATE oauth_tokens SET last_used_at = ?1 WHERE id = ?2")
    .bind(now, row.token_id)
    .run()
    .catch(() => {});

  return { id: row.id, email: row.email };
}
