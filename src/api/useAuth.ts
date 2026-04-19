import { useCallback, useEffect, useState } from "react";
import { api, type RemoteUser } from "./client";

/**
 * Auth state hook. On mount:
 *   - checks /api/auth/me for an existing session
 *   - if the current URL carries ?magic=<token>, verifies it and cleans the URL
 */
export function useAuth() {
  const [user, setUser] = useState<RemoteUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = new URL(window.location.href);
        const magic = url.searchParams.get("magic");
        if (magic) {
          url.searchParams.delete("magic");
          url.searchParams.delete("email");
          window.history.replaceState({}, "", url.toString());
          try {
            const { user } = await api.verifyMagicLink(magic);
            if (!cancelled) setUser(user);
            return;
          } catch (e) {
            if (!cancelled) setError(e instanceof Error ? e.message : "verification failed");
          }
        }
        const { user } = await api.me();
        if (!cancelled) setUser(user);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const requestLink = useCallback(async (email: string): Promise<string | null> => {
    setError("");
    const res = await api.requestMagicLink(email);
    return res.devLink ?? null;
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
  }, []);

  return { user, loading, error, requestLink, logout };
}
