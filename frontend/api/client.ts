// Frontend and Pages Functions API are same-origin; "/api" works everywhere.

const API_BASE = "/api";

export interface RemoteUser {
  id: string;
  email: string;
}

export interface RemoteActivitySummary {
  id: string;
  fileName: string;
  startTime: string | null;
  sport: string | null;
  workoutType: string | null;
  totalDistance: number | null;
  totalElapsedTime: number | null;
  fitSize: number | null;
  jsonSize: number | null;
  uploadedAt: number;
}

export interface TokenSummary {
  id: string;
  label: string | null;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface CreatedToken {
  id: string;
  token: string;
  label: string | null;
  prefix: string;
  createdAt: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? safeParse(text) : null;
  if (!res.ok) {
    const msg = (body && typeof body === "object" && "error" in body
      ? String((body as { error: unknown }).error)
      : null) ?? `request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export const api = {
  me(): Promise<{ user: RemoteUser | null }> {
    return request("/auth/me");
  },
  requestMagicLink(email: string): Promise<{ ok: true; devLink?: string }> {
    return request("/auth/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },
  verifyMagicLink(token: string): Promise<{ ok: true; user: RemoteUser }> {
    return request("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },
  logout(): Promise<{ ok: true }> {
    return request("/auth/logout", { method: "POST" });
  },
  listActivities(): Promise<{ activities: RemoteActivitySummary[] }> {
    return request("/activities");
  },
  uploadActivity(
    fileName: string,
    fitBuffer: ArrayBuffer,
    parsedJson: string,
  ): Promise<{ ok: true; id: string; fileName: string }> {
    const form = new FormData();
    form.append("fileName", fileName);
    form.append("fit", new Blob([fitBuffer], { type: "application/vnd.ant.fit" }), fileName);
    form.append("parsed", new Blob([parsedJson], { type: "application/json" }), "parsed.json");
    return request("/activities", { method: "POST", body: form });
  },
  downloadActivityJson<T = unknown>(id: string): Promise<T> {
    return request<T>(`/activities/${id}/json`);
  },
  listTokens(): Promise<{ tokens: TokenSummary[] }> {
    return request("/tokens");
  },
  createToken(label: string): Promise<CreatedToken> {
    return request("/tokens", { method: "POST", body: JSON.stringify({ label }) });
  },
  revokeToken(id: string): Promise<{ ok: true }> {
    return request(`/tokens/${id}`, { method: "DELETE" });
  },
};
