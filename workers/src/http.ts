export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

export function error(status: number, message: string): Response {
  return json({ error: message }, { status });
}

export function corsHeaders(origin: string | null, appUrl: string): HeadersInit {
  const allowed = new URL(appUrl).origin;
  const allow = origin === allowed ? origin : allowed;
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "origin",
  };
}

export function withCors(res: Response, headers: HeadersInit): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(headers)) h.set(k, v as string);
  return new Response(res.body, { status: res.status, headers: h });
}
