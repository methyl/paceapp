// Scheduled backfill: walks every activity whose `meta` column is missing
// or stale, re-reads the parsed JSON from R2, and writes the recomputed
// ActivityMeta blob back to D1. Works across all users — the scheduled
// runtime is trusted, no auth needed.
//
// Triggered by cron (see wrangler.toml). Also accepts POST / for manual
// runs via `wrangler deploy && curl https://…` during development.

import { deriveMeta } from "../../src/meta";

interface Env {
  DB: D1Database;
  FIT_BUCKET: R2Bucket;
}

const BATCH_SIZE = 200;
const MAX_ROWS_PER_RUN = 2000;

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(refreshAll(env, { onlyMissing: true }).then(logResult));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("POST / to trigger a backfill", { status: 405 });
    }
    const url = new URL(req.url);
    const onlyMissing = url.searchParams.get("only_missing") !== "false";
    const result = await refreshAll(env, { onlyMissing });
    logResult(result);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { "content-type": "application/json" },
    });
  },
};

interface RefreshOpts {
  onlyMissing: boolean;
}

interface RefreshResult {
  scanned: number;
  updated: number;
  unchanged: number;
  missing_blob: number;
  only_missing: boolean;
}

async function refreshAll(env: Env, opts: RefreshOpts): Promise<RefreshResult> {
  const result: RefreshResult = {
    scanned: 0,
    updated: 0,
    unchanged: 0,
    missing_blob: 0,
    only_missing: opts.onlyMissing,
  };

  // onlyMissing: the filter naturally shrinks as we update rows, so we can
  //   just loop until the next page is empty.
  // full rescan: advance an offset so we don't re-read rows already scanned.
  let offset = 0;
  while (result.scanned < MAX_ROWS_PER_RUN) {
    const sql = opts.onlyMissing
      ? `SELECT id, json_r2_key, meta FROM activities
         WHERE meta IS NULL OR meta = '' OR meta = '{}'
         LIMIT ${BATCH_SIZE}`
      : `SELECT id, json_r2_key, meta FROM activities
         ORDER BY id
         LIMIT ${BATCH_SIZE} OFFSET ${offset}`;
    const rows = await env.DB.prepare(sql).all<{
      id: string; json_r2_key: string; meta: string | null;
    }>();
    const batch = rows.results ?? [];
    if (batch.length === 0) break;

    for (const r of batch) {
      result.scanned++;
      const obj = await env.FIT_BUCKET.get(r.json_r2_key);
      if (!obj) { result.missing_blob++; continue; }
      const full = (await obj.json()) as Record<string, unknown>;
      const nextJson = JSON.stringify(deriveMeta(full));
      if (nextJson === (r.meta ?? null)) { result.unchanged++; continue; }
      await env.DB.prepare("UPDATE activities SET meta = ?1 WHERE id = ?2")
        .bind(nextJson, r.id)
        .run();
      result.updated++;
    }

    if (!opts.onlyMissing) offset += BATCH_SIZE;
    if (batch.length < BATCH_SIZE) break;
  }

  return result;
}

function logResult(r: RefreshResult): void {
  console.log(
    `backfill: scanned=${r.scanned} updated=${r.updated} unchanged=${r.unchanged}` +
      ` missing_blob=${r.missing_blob} only_missing=${r.only_missing}`,
  );
}
