import type { Env } from "../env";
import { json, error } from "../http";
import { getUserFromRequest } from "../auth";
import { type ActivityMeta, META_VERSION, deriveMeta, parseMeta } from "../meta";

const MAX_FIT_BYTES = 20 * 1024 * 1024; // 20 MB per FIT file
const MAX_JSON_BYTES = 30 * 1024 * 1024; // 30 MB parsed JSON

interface ActivityRow {
  id: string;
  file_name: string;
  start_time: string | null;
  sport: string | null;
  workout_type: string | null;
  total_distance: number | null;
  total_elapsed_time: number | null;
  fit_size: number | null;
  json_size: number | null;
  uploaded_at: number;
  meta: string | null;
}

export async function listActivities(req: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(req, env);
  if (!user) return error(401, "not authenticated");

  const { results } = await env.DB.prepare(
    `SELECT id, file_name, start_time, sport, workout_type,
            total_distance, total_elapsed_time, fit_size, json_size,
            uploaded_at, meta
     FROM activities
     WHERE user_id = ?1
     ORDER BY COALESCE(start_time, '') DESC`,
  )
    .bind(user.id)
    .all<ActivityRow>();

  return json({
    activities: (results ?? []).map((r) => {
      const meta = parseMeta(r.meta);
      return {
        id: r.id,
        fileName: r.file_name,
        startTime: r.start_time,
        sport: r.sport,
        workoutType: r.workout_type,
        totalDistance: r.total_distance,
        totalElapsedTime: r.total_elapsed_time,
        fitSize: r.fit_size,
        jsonSize: r.json_size,
        uploadedAt: r.uploaded_at,
        workoutLabel: meta.workoutLabel ?? null,
        totalAscent: meta.totalAscent ?? null,
        totalDescent: meta.totalDescent ?? null,
      };
    }),
  });
}

/**
 * POST /api/activities
 * Content-Type: multipart/form-data with fields:
 *   fileName  string
 *   fit       File (original .fit bytes)
 *   parsed    File (JSON ParsedActivity)
 * Idempotent per (user, fileName) — overwrites existing row and R2 objects.
 */
export async function uploadActivity(req: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(req, env);
  if (!user) return error(401, "not authenticated");

  const ct = req.headers.get("content-type") || "";
  if (!ct.startsWith("multipart/form-data")) return error(415, "expected multipart/form-data");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return error(400, "invalid form");
  }

  const fileName = String(form.get("fileName") ?? "").trim();
  const fit = form.get("fit");
  const parsed = form.get("parsed");
  if (!fileName) return error(400, "missing fileName");
  if (!isBlob(fit)) return error(400, "missing fit blob");
  if (!isBlob(parsed)) return error(400, "missing parsed blob");
  if (fit.size > MAX_FIT_BYTES) return error(413, "fit file too large");
  if (parsed.size > MAX_JSON_BYTES) return error(413, "parsed json too large");

  let parsedMeta: ParsedMeta;
  try {
    const text = await parsed.text();
    parsedMeta = extractMeta(JSON.parse(text), fileName);
  } catch {
    return error(400, "parsed json invalid");
  }

  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB.prepare(
    "SELECT id, fit_r2_key, json_r2_key FROM activities WHERE user_id = ?1 AND file_name = ?2",
  )
    .bind(user.id, fileName)
    .first<{ id: string; fit_r2_key: string; json_r2_key: string }>();

  const id = existing?.id ?? crypto.randomUUID();
  const fitKey = `users/${user.id}/fit/${id}.fit`;
  const jsonKey = `users/${user.id}/json/${id}.json`;

  const fitBytes = await fit.arrayBuffer();
  const parsedBytes = await parsed.arrayBuffer();

  await env.FIT_BUCKET.put(fitKey, fitBytes, {
    httpMetadata: { contentType: "application/vnd.ant.fit" },
  });
  await env.FIT_BUCKET.put(jsonKey, parsedBytes, {
    httpMetadata: { contentType: "application/json" },
  });

  const metaJson = JSON.stringify(parsedMeta.meta);

  if (existing) {
    await env.DB.prepare(
      `UPDATE activities SET
         start_time = ?1, sport = ?2, workout_type = ?3,
         total_distance = ?4, total_elapsed_time = ?5,
         fit_r2_key = ?6, json_r2_key = ?7,
         fit_size = ?8, json_size = ?9,
         uploaded_at = ?10, meta = ?11, meta_version = ?12
       WHERE id = ?13 AND user_id = ?14`,
    )
      .bind(
        parsedMeta.startTime,
        parsedMeta.sport,
        parsedMeta.workoutType,
        parsedMeta.totalDistance,
        parsedMeta.totalElapsedTime,
        fitKey,
        jsonKey,
        fitBytes.byteLength,
        parsedBytes.byteLength,
        now,
        metaJson,
        META_VERSION,
        id,
        user.id,
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO activities
         (id, user_id, file_name, start_time, sport, workout_type,
          total_distance, total_elapsed_time,
          fit_r2_key, json_r2_key, fit_size, json_size, uploaded_at,
          meta, meta_version)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
    )
      .bind(
        id,
        user.id,
        fileName,
        parsedMeta.startTime,
        parsedMeta.sport,
        parsedMeta.workoutType,
        parsedMeta.totalDistance,
        parsedMeta.totalElapsedTime,
        fitKey,
        jsonKey,
        fitBytes.byteLength,
        parsedBytes.byteLength,
        now,
        metaJson,
        META_VERSION,
      )
      .run();
  }

  return json({ ok: true, id, fileName });
}

export async function downloadActivityFit(
  req: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const user = await getUserFromRequest(req, env);
  if (!user) return error(401, "not authenticated");

  const row = await env.DB.prepare(
    "SELECT fit_r2_key, file_name FROM activities WHERE id = ?1 AND user_id = ?2",
  )
    .bind(id, user.id)
    .first<{ fit_r2_key: string; file_name: string }>();
  if (!row) return error(404, "not found");

  const obj = await env.FIT_BUCKET.get(row.fit_r2_key);
  if (!obj) return error(404, "blob missing");
  return new Response(obj.body, {
    headers: {
      "content-type": "application/vnd.ant.fit",
      "content-disposition": `attachment; filename="${row.file_name.replace(/"/g, "")}"`,
    },
  });
}

export async function downloadActivityJson(
  req: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const user = await getUserFromRequest(req, env);
  if (!user) return error(401, "not authenticated");

  const row = await env.DB.prepare(
    "SELECT json_r2_key FROM activities WHERE id = ?1 AND user_id = ?2",
  )
    .bind(id, user.id)
    .first<{ json_r2_key: string }>();
  if (!row) return error(404, "not found");

  const obj = await env.FIT_BUCKET.get(row.json_r2_key);
  if (!obj) return error(404, "blob missing");
  return new Response(obj.body, {
    headers: { "content-type": "application/json" },
  });
}

export async function deleteActivity(
  req: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const user = await getUserFromRequest(req, env);
  if (!user) return error(401, "not authenticated");

  const row = await env.DB.prepare(
    "SELECT fit_r2_key, json_r2_key FROM activities WHERE id = ?1 AND user_id = ?2",
  )
    .bind(id, user.id)
    .first<{ fit_r2_key: string; json_r2_key: string }>();
  if (!row) return error(404, "not found");

  await env.FIT_BUCKET.delete(row.fit_r2_key).catch(() => {});
  await env.FIT_BUCKET.delete(row.json_r2_key).catch(() => {});
  await env.DB.prepare("DELETE FROM activities WHERE id = ?1 AND user_id = ?2")
    .bind(id, user.id)
    .run();

  return json({ ok: true });
}

interface ParsedMeta {
  startTime: string | null;
  sport: string | null;
  workoutType: string | null;
  totalDistance: number | null;
  totalElapsedTime: number | null;
  meta: ActivityMeta;
}

function extractMeta(obj: unknown, _fileName: string): ParsedMeta {
  const a = obj as {
    summary?: {
      startTime?: string;
      sport?: string;
      totalDistance?: number;
      totalElapsedTime?: number;
    };
    workoutType?: string;
  };
  return {
    startTime: a?.summary?.startTime ?? null,
    sport: a?.summary?.sport ?? null,
    workoutType: a?.workoutType ?? null,
    totalDistance: numOrNull(a?.summary?.totalDistance),
    totalElapsedTime: numOrNull(a?.summary?.totalElapsedTime),
    meta: deriveMeta(obj),
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Workers runtime exposes File via FormDataEntryValue but the type isn't
// guaranteed in @cloudflare/workers-types — duck-type instead.
function isBlob(v: unknown): v is Blob {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof (v as Blob).arrayBuffer === "function" &&
    typeof (v as Blob).size === "number"
  );
}
