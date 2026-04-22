// Backfill Worker for activities.meta.
//
// Producer (fetch() + scheduled()):
//   Scans `activities` for rows whose meta_version is behind the current
//   META_VERSION, enqueues their IDs in sendBatch chunks of 100, and
//   returns. Bounded per invocation so we stay under the Worker CPU limit
//   even at millions of rows — the cron retrigger drains the rest.
//
// Consumer (queue()):
//   Receives up to 100 IDs at a time. For each row, fetches the parsed
//   activity JSON from R2, derives the new meta, then writes meta +
//   meta_version back via a single D1 .batch() call. Failures on
//   individual messages are retried up to max_retries times before going
//   to the DLQ.
import { deriveMeta, META_VERSION } from "../../src/meta";

const SWEEP_BATCH_SIZE = 100; // queue sendBatch limit
const SWEEP_MAX_PER_INVOCATION = 50_000; // bound per fetch/scheduled tick

export interface Env {
  DB: D1Database;
  FIT_BUCKET: R2Bucket;
  BACKFILL_QUEUE: Queue<BackfillMessage>;
  SWEEP_SECRET: string;
}

interface BackfillMessage {
  id: string;
  userId: string;
  jsonKey: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/sweep" || req.method !== "POST") {
      return new Response("not found", { status: 404 });
    }
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${env.SWEEP_SECRET}`) {
      return new Response("unauthorized", { status: 401 });
    }
    const enqueued = await sweep(env);
    return Response.json({ enqueued });
  },

  async scheduled(_ev: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sweep(env).then((n) => console.log(`sweep: enqueued ${n}`)));
  },

  async queue(batch: MessageBatch<BackfillMessage>, env: Env): Promise<void> {
    const updates = await Promise.all(
      batch.messages.map((msg) => buildUpdate(msg, env)),
    );
    const stmts = updates.filter((s): s is D1PreparedStatement => s !== null);
    if (stmts.length > 0) await env.DB.batch(stmts);

    for (let i = 0; i < batch.messages.length; i++) {
      if (updates[i]) batch.messages[i].ack();
      else batch.messages[i].retry();
    }
  },
};

async function sweep(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, user_id AS userId, json_r2_key AS jsonKey
     FROM activities
     WHERE meta_version IS NULL OR meta_version < ?1
     LIMIT ?2`,
  )
    .bind(META_VERSION, SWEEP_MAX_PER_INVOCATION)
    .all<BackfillMessage>();

  const rows = results ?? [];
  for (let i = 0; i < rows.length; i += SWEEP_BATCH_SIZE) {
    const chunk = rows.slice(i, i + SWEEP_BATCH_SIZE);
    await env.BACKFILL_QUEUE.sendBatch(chunk.map((body) => ({ body })));
  }
  return rows.length;
}

async function buildUpdate(
  msg: Message<BackfillMessage>,
  env: Env,
): Promise<D1PreparedStatement | null> {
  try {
    const obj = await env.FIT_BUCKET.get(msg.body.jsonKey);
    if (!obj) {
      // Row points at an R2 object that's gone — mark the row at current
      // version with empty meta so we don't retry it forever.
      return env.DB.prepare(
        "UPDATE activities SET meta = ?1, meta_version = ?2 WHERE id = ?3 AND user_id = ?4",
      ).bind("{}", META_VERSION, msg.body.id, msg.body.userId);
    }
    const full = (await obj.json()) as Record<string, unknown>;
    const meta = deriveMeta(full);
    return env.DB.prepare(
      "UPDATE activities SET meta = ?1, meta_version = ?2 WHERE id = ?3 AND user_id = ?4",
    ).bind(JSON.stringify(meta), META_VERSION, msg.body.id, msg.body.userId);
  } catch (e) {
    console.warn(`backfill: build failed for ${msg.body.id}: ${(e as Error).message}`);
    return null;
  }
}
