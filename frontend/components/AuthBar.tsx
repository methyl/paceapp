import { useState } from "react";
import type { RemoteUser } from "../api/client";
import McpAccessModal from "./McpAccessModal";

interface Props {
  user: RemoteUser | null;
  loading: boolean;
  onRequestLink: (email: string) => Promise<string | null>;
  onLogout: () => void;
}

export default function AuthBar({ user, loading, onRequestLink, onLogout }: Props) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [devLink, setDevLink] = useState<string | null>(null);
  const [mcpOpen, setMcpOpen] = useState(false);

  if (loading) return <span className="text-xs text-gray-400">…</span>;

  if (user) {
    return (
      <>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-600">{user.email}</span>
          <button
            onClick={() => setMcpOpen(true)}
            className="text-gray-500 hover:text-gray-800 underline"
          >
            MCP
          </button>
          <button
            onClick={onLogout}
            className="text-gray-500 hover:text-gray-800 underline"
          >
            sign out
          </button>
        </div>
        <McpAccessModal open={mcpOpen} onClose={() => setMcpOpen(false)} />
      </>
    );
  }

  if (sent) {
    return (
      <div className="text-xs text-gray-600">
        Check <span className="font-medium">{email}</span> for a sign-in link.
        {devLink && (
          <div className="mt-1">
            <a className="text-blue-600 underline break-all" href={devLink}>
              (dev) open link
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!email) return;
        setSending(true);
        setErr("");
        try {
          const dev = await onRequestLink(email.trim().toLowerCase());
          setDevLink(dev);
          setSent(true);
        } catch (e) {
          setErr(e instanceof Error ? e.message : "failed");
        } finally {
          setSending(false);
        }
      }}
    >
      <input
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="border border-gray-300 rounded px-2 py-1 text-xs w-48"
      />
      <button
        type="submit"
        disabled={sending}
        className="px-2 py-1 rounded bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
      >
        {sending ? "…" : "Sign in"}
      </button>
      {err && <span className="text-red-600 text-xs ml-1">{err}</span>}
    </form>
  );
}
