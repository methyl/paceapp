import type { Env } from "./env";
import { corsHeaders, error, withCors } from "./http";
import {
  requestMagicLink,
  verifyMagicLink,
  verifyMagicLinkGet,
  logout,
  me,
} from "./routes/authRoutes";
import {
  discovery,
  protectedResource,
  register as oauthRegister,
  authorizeGet,
  authorizePost,
  signin as oauthSignin,
  token as oauthToken,
} from "./routes/oauthRoutes";
import {
  listActivities,
  uploadActivity,
  downloadActivityFit,
  downloadActivityJson,
  deleteActivity,
} from "./routes/activityRoutes";
import { listTokens, createToken, revokeToken } from "./routes/tokenRoutes";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(req.headers.get("origin"), env.APP_URL);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const res = await route(req, env, url);
    return withCors(res, cors);
  },
};

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = req.method;

  if (pathname === "/api/health" && method === "GET") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (pathname === "/api/auth/request" && method === "POST") return requestMagicLink(req, env);
  if (pathname === "/api/auth/verify" && method === "POST") return verifyMagicLink(req, env);
  if (pathname === "/api/auth/verify" && method === "GET") return verifyMagicLinkGet(req, env);
  if (pathname === "/api/auth/logout" && method === "POST") return logout(req, env);
  if (pathname === "/api/auth/me" && method === "GET") return me(req, env);

  if (pathname === "/.well-known/oauth-authorization-server" && method === "GET")
    return discovery(req, env);
  if (pathname === "/.well-known/oauth-protected-resource" && method === "GET")
    return protectedResource(req, env);
  if (pathname === "/oauth/register" && method === "POST") return oauthRegister(req, env);
  if (pathname === "/oauth/authorize" && method === "GET") return authorizeGet(req, env);
  if (pathname === "/oauth/authorize" && method === "POST") return authorizePost(req, env);
  if (pathname === "/oauth/signin" && method === "POST") return oauthSignin(req, env);
  if (pathname === "/oauth/token" && method === "POST") return oauthToken(req, env);

  if (pathname === "/api/activities" && method === "GET") return listActivities(req, env);
  if (pathname === "/api/activities" && method === "POST") return uploadActivity(req, env);

  const activityMatch = pathname.match(/^\/api\/activities\/([a-zA-Z0-9-]+)(\/fit|\/json)?$/);
  if (activityMatch) {
    const [, id, sub] = activityMatch;
    if (method === "DELETE" && !sub) return deleteActivity(req, env, id);
    if (method === "GET" && sub === "/fit") return downloadActivityFit(req, env, id);
    if (method === "GET" && sub === "/json") return downloadActivityJson(req, env, id);
  }

  if (pathname === "/api/tokens" && method === "GET") return listTokens(req, env);
  if (pathname === "/api/tokens" && method === "POST") return createToken(req, env);
  const tokenMatch = pathname.match(/^\/api\/tokens\/([a-zA-Z0-9-]+)$/);
  if (tokenMatch && method === "DELETE") return revokeToken(req, env, tokenMatch[1]);

  return error(404, "not found");
}
