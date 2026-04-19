import type { Env } from "../../workers/src/env";
import { getUserFromBearer } from "../../workers/src/routes/tokenRoutes";
import { getUserFromOAuthBearer } from "../../workers/src/routes/oauthRoutes";
import { TOOL_DEFINITIONS, callTool } from "../../workers/src/mcp/tools";

// Minimal MCP streamable-HTTP transport: POST /mcp → JSON-RPC response.
// Clients (e.g. Claude Desktop) connect via:
//   npx mcp-remote https://…/mcp --header "Authorization: Bearer pcapp_…"

const PROTOCOL_VERSION = "2025-03-26";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/mcp") {
    return new Response("MCP endpoint; POST JSON-RPC here.", {
      headers: { "content-type": "text/plain" },
    });
  }

  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const user =
    (await getUserFromBearer(request, env)) ||
    (await getUserFromOAuthBearer(request, env));
  if (!user) {
    const base = env.APP_URL.replace(/\/+$/, "");
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          // RFC 9728 hint so OAuth-aware clients discover the authorization server.
          "www-authenticate": `Bearer realm="paceapp", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
        },
      },
    );
  }

  let req: JsonRpcRequest;
  try {
    req = (await request.json()) as JsonRpcRequest;
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
  }

  const id = req.id ?? null;

  // Notifications (no id) don't require a response, but return 204 to be safe.
  if (req.id === undefined || req.id === null) {
    // e.g. notifications/initialized
    return new Response(null, { status: 204 });
  }

  try {
    switch (req.method) {
      case "initialize":
        return json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "paceapp", version: "0.1.0" },
          },
        });

      case "tools/list":
        return json({
          jsonrpc: "2.0",
          id,
          result: { tools: TOOL_DEFINITIONS },
        });

      case "tools/call": {
        const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        if (!params.name) throw rpcError(-32602, "missing tool name");
        const result = await callTool(params.name, params.arguments ?? {}, env, user);
        return json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        });
      }

      case "ping":
        return json({ jsonrpc: "2.0", id, result: {} });

      default:
        return json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${req.method}` },
        });
    }
  } catch (e) {
    const err = e as RpcError;
    return json({
      jsonrpc: "2.0",
      id,
      error: {
        code: err.code ?? -32000,
        message: err.message ?? "internal error",
      },
    });
  }
};

interface RpcError extends Error {
  code?: number;
}

function rpcError(code: number, message: string): RpcError {
  const e = new Error(message) as RpcError;
  e.code = code;
  return e;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
