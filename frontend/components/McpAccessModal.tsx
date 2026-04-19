import { useCallback, useEffect, useState } from "react";
import { api, type CreatedToken, type TokenSummary } from "../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
}

const MCP_URL =
  typeof window !== "undefined"
    ? `${window.location.origin}/mcp`
    : "https://paceapp-7mx.pages.dev/mcp";

export default function McpAccessModal({ open, onClose }: Props) {
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedToken | null>(null);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    try {
      const { tokens } = await api.listTokens();
      setTokens(tokens);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load tokens");
    }
  }, []);

  useEffect(() => {
    if (open) {
      setJustCreated(null);
      setErr("");
      refresh();
    }
  }, [open, refresh]);

  if (!open) return null;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setErr("");
    try {
      const created = await api.createToken(label);
      setJustCreated(created);
      setLabel("");
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to create token");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Revoke this token? Clients using it will lose access immediately.")) return;
    try {
      await api.revokeToken(id);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to revoke");
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Claude / MCP Access</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-5 text-sm">
          {justCreated ? (
            <NewTokenReveal
              created={justCreated}
              mcpUrl={MCP_URL}
              onDone={() => setJustCreated(null)}
            />
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Server URL
                </label>
                <CopyableField value={MCP_URL} />
              </div>

              <div>
                <h3 className="text-xs font-medium text-gray-600 mb-2 uppercase tracking-wide">
                  Your tokens
                </h3>
                {tokens === null ? (
                  <p className="text-gray-500 text-xs">Loading…</p>
                ) : tokens.length === 0 ? (
                  <p className="text-gray-500 text-xs">No tokens yet.</p>
                ) : (
                  <TokenList tokens={tokens} onRevoke={handleRevoke} />
                )}
              </div>

              <form onSubmit={handleGenerate} className="flex items-end gap-2 pt-2 border-t border-gray-100">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Generate new token
                  </label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Label (e.g. laptop)"
                    maxLength={64}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-3 py-1.5 rounded bg-blue-600 text-white font-medium text-sm disabled:opacity-50"
                >
                  {creating ? "…" : "Generate"}
                </button>
              </form>
              {err && <p className="text-red-600 text-xs">{err}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TokenList({
  tokens,
  onRevoke,
}: {
  tokens: TokenSummary[];
  onRevoke: (id: string) => void;
}) {
  const fmt = (ts: number | null) => {
    if (!ts) return "never";
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  return (
    <div className="border border-gray-200 rounded overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="text-left px-3 py-1.5">Label</th>
            <th className="text-left px-3 py-1.5">Prefix</th>
            <th className="text-left px-3 py-1.5">Created</th>
            <th className="text-left px-3 py-1.5">Last used</th>
            <th className="px-3 py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={t.id} className="border-t border-gray-100">
              <td className="px-3 py-1.5">{t.label || <span className="text-gray-400">—</span>}</td>
              <td className="px-3 py-1.5 font-mono text-gray-500">pcapp_{t.prefix}…</td>
              <td className="px-3 py-1.5 text-gray-500">{fmt(t.createdAt)}</td>
              <td className="px-3 py-1.5 text-gray-500">{fmt(t.lastUsedAt)}</td>
              <td className="px-3 py-1.5 text-right">
                <button
                  onClick={() => onRevoke(t.id)}
                  className="text-red-600 hover:text-red-800 text-xs"
                >
                  Revoke
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NewTokenReveal({
  created,
  mcpUrl,
  onDone,
}: {
  created: CreatedToken;
  mcpUrl: string;
  onDone: () => void;
}) {
  const config = JSON.stringify(
    {
      mcpServers: {
        paceapp: {
          command: "npx",
          args: [
            "mcp-remote",
            mcpUrl,
            "--header",
            `Authorization: Bearer ${created.token}`,
          ],
        },
      },
    },
    null,
    2,
  );
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-amber-900 text-xs">
        Copy this token now — it won't be shown again.
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Token{created.label ? ` (${created.label})` : ""}
        </label>
        <CopyableField value={created.token} mono />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Claude Desktop config
        </label>
        <CopyableField value={config} mono multiline />
      </div>
      <div className="flex justify-end">
        <button
          onClick={onDone}
          className="px-3 py-1.5 rounded bg-gray-900 text-white font-medium text-sm"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function CopyableField({
  value,
  mono,
  multiline,
}: {
  value: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <div className="flex items-start gap-2">
      {multiline ? (
        <pre
          className={`flex-1 border border-gray-300 rounded px-2 py-1.5 bg-gray-50 overflow-auto max-h-48 ${
            mono ? "font-mono text-xs" : "text-sm"
          }`}
        >
          {value}
        </pre>
      ) : (
        <input
          readOnly
          value={value}
          className={`flex-1 border border-gray-300 rounded px-2 py-1.5 bg-gray-50 ${
            mono ? "font-mono text-xs" : "text-sm"
          }`}
          onClick={(e) => e.currentTarget.select()}
        />
      )}
      <button
        onClick={handleCopy}
        className="px-2 py-1.5 rounded border border-gray-300 text-gray-700 text-xs hover:bg-gray-50"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
