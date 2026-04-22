import type { Env } from "../env";
import type { User } from "../auth";
import { findMatches, type Reference, type LoadCategory } from "./matching";
import { parseMeta, deriveMeta, META_VERSION } from "../meta";

export const TOOL_DEFINITIONS = [
  {
    name: "list_activities",
    description:
      "List the user's activities with optional filters. Returns metadata only (including workout label, elevation gain/loss, and tags; no per-record data).",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO date inclusive lower bound (e.g. 2026-01-01)" },
        to: { type: "string", description: "ISO date inclusive upper bound" },
        sport: { type: "string" },
        workout_type: { type: "string", description: "Legacy single-value filter; prefer `tags`." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tag names to filter on (AND across values). Examples: intervals, hilly, threshold, vo2, anaerobic, hill-intervals, progressive, strides, race, easy, steady, tempo.",
        },
        limit: { type: "number", description: "Max rows (default 100, max 500)" },
      },
    },
  },
  {
    name: "tag_counts",
    description:
      "Return the number of the user's activities carrying each tag. Useful for populating the filter chip row or summarizing a training block.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO date inclusive lower bound" },
        to: { type: "string", description: "ISO date inclusive upper bound" },
      },
    },
  },
  {
    name: "get_activity",
    description:
      "Fetch the full parsed JSON for one activity (laps, segments, records). Always returns the workout label and elevation aggregates; use `parts` to exclude heavy sections.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        parts: {
          type: "array",
          items: { enum: ["summary", "laps", "segments", "records"] },
          description: "Which sections to include; default: summary + laps + segments.",
        },
      },
    },
  },
  {
    name: "similar_intervals",
    description:
      "Find past segments that match a reference interval (pace ± tolerance, similar prior-load, same distance bucket). Returns aggregated EF and HR per workout.",
    inputSchema: {
      type: "object",
      required: ["pace_s_per_km", "distance_bucket"],
      properties: {
        pace_s_per_km: { type: "number", description: "Target pace in seconds per kilometer" },
        distance_bucket: {
          enum: ["strides", "400m", "800m", "1km", "2km", "4km", "5km"],
        },
        load: {
          enum: ["fresh", "light", "moderate", "heavy"],
          description: "Prior load at the reference segment (default moderate).",
        },
        tolerance_s: { type: "number", description: "Pace match tolerance s/km (default 15)" },
        within_days: { type: "number", description: "Only look back N days" },
        z2_ceiling: { type: "number", description: "Z2 HR ceiling for load calc (default 140)" },
      },
    },
  },
] as const;

type Tool = (typeof TOOL_DEFINITIONS)[number]["name"];

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  env: Env,
  user: User,
): Promise<unknown> {
  const tool = name as Tool;
  switch (tool) {
    case "list_activities":
      return listActivities(args, env, user);
    case "get_activity":
      return getActivity(args, env, user);
    case "similar_intervals":
      return similarIntervals(args, env, user);
    case "tag_counts":
      return tagCounts(args, env, user);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// --- tool impls ---

async function listActivities(
  args: Record<string, unknown>,
  env: Env,
  user: User,
) {
  const from = typeof args.from === "string" ? args.from : null;
  const to = typeof args.to === "string" ? args.to : null;
  const sport = typeof args.sport === "string" ? args.sport : null;
  const workoutType = typeof args.workout_type === "string" ? args.workout_type : null;
  const tags = Array.isArray(args.tags)
    ? (args.tags as unknown[]).filter((t): t is string => typeof t === "string" && t.length > 0)
    : [];
  const limit = Math.min(Number(args.limit) || 100, 500);

  const clauses = ["a.user_id = ?1"];
  const binds: unknown[] = [user.id];
  if (from) { binds.push(from); clauses.push(`a.start_time >= ?${binds.length}`); }
  if (to)   { binds.push(to);   clauses.push(`a.start_time <= ?${binds.length}`); }
  if (sport){ binds.push(sport); clauses.push(`a.sport = ?${binds.length}`); }
  if (workoutType) { binds.push(workoutType); clauses.push(`a.workout_type = ?${binds.length}`); }
  // Multi-tag AND: one EXISTS per tag.
  for (const tag of tags) {
    binds.push(tag);
    clauses.push(
      `EXISTS (SELECT 1 FROM activity_tags t WHERE t.activity_id = a.id AND t.tag = ?${binds.length})`,
    );
  }

  const rows = await env.DB.prepare(
    `SELECT a.id, a.file_name, a.start_time, a.sport, a.workout_type,
            a.total_distance, a.total_elapsed_time, a.uploaded_at, a.meta,
            (SELECT GROUP_CONCAT(t.tag) FROM activity_tags t WHERE t.activity_id = a.id) AS tags
     FROM activities a
     WHERE ${clauses.join(" AND ")}
     ORDER BY COALESCE(a.start_time, '') DESC
     LIMIT ${limit}`,
  )
    .bind(...binds)
    .all<{
      id: string; file_name: string; start_time: string | null; sport: string | null;
      workout_type: string | null; total_distance: number | null;
      total_elapsed_time: number | null; uploaded_at: number;
      meta: string | null; tags: string | null;
    }>();

  return {
    activities: (rows.results ?? []).map((r) => {
      const m = parseMeta(r.meta);
      return {
        id: r.id,
        file_name: r.file_name,
        start_time: r.start_time,
        sport: r.sport,
        workout_type: r.workout_type,
        tags: r.tags ? r.tags.split(",") : [],
        workout_label: m.workoutLabel ?? null,
        total_distance_m: r.total_distance,
        total_elapsed_s: r.total_elapsed_time,
        total_ascent_m: m.totalAscent ?? null,
        total_descent_m: m.totalDescent ?? null,
        uploaded_at: r.uploaded_at,
      };
    }),
  };
}

async function getActivity(
  args: Record<string, unknown>,
  env: Env,
  user: User,
) {
  const id = String(args.id ?? "");
  if (!id) throw new Error("id required");
  const partsIn = Array.isArray(args.parts) ? (args.parts as string[]) : null;
  const parts = new Set(partsIn ?? ["summary", "laps", "segments"]);

  const row = await env.DB.prepare(
    `SELECT json_r2_key, file_name, workout_type, meta
     FROM activities WHERE id = ?1 AND user_id = ?2`,
  )
    .bind(id, user.id)
    .first<{
      json_r2_key: string; file_name: string;
      workout_type: string | null; meta: string | null;
    }>();
  if (!row) throw new Error("activity not found");

  const obj = await env.FIT_BUCKET.get(row.json_r2_key);
  if (!obj) throw new Error("activity json missing");
  const full = (await obj.json()) as Record<string, unknown>;
  let m = parseMeta(row.meta);
  if (!row.meta || Object.keys(m).length === 0) {
    m = deriveMeta(full);
    await env.DB.prepare(
      "UPDATE activities SET meta = ?1, meta_version = ?2 WHERE id = ?3 AND user_id = ?4",
    )
      .bind(JSON.stringify(m), META_VERSION, id, user.id)
      .run();
  }

  const out: Record<string, unknown> = {
    id,
    file_name: row.file_name,
    workout_type: row.workout_type ?? full.workoutType ?? null,
    workout_label: m.workoutLabel ?? full.workoutLabel ?? null,
    total_ascent_m: m.totalAscent ?? null,
    total_descent_m: m.totalDescent ?? null,
  };
  if (parts.has("summary")) out.summary = full.summary;
  if (parts.has("laps")) out.laps = full.laps;
  if (parts.has("segments")) out.segments = full.segments;
  if (parts.has("records")) out.records = full.records;

  const tagRows = await env.DB.prepare(
    "SELECT tag FROM activity_tags WHERE activity_id = ?1",
  )
    .bind(id)
    .all<{ tag: string }>();
  out.tags = (tagRows.results ?? []).map((t) => t.tag);

  return out;
}

async function tagCounts(
  args: Record<string, unknown>,
  env: Env,
  user: User,
) {
  const from = typeof args.from === "string" ? args.from : null;
  const to = typeof args.to === "string" ? args.to : null;

  const clauses = ["a.user_id = ?1"];
  const binds: unknown[] = [user.id];
  if (from) { binds.push(from); clauses.push(`a.start_time >= ?${binds.length}`); }
  if (to)   { binds.push(to);   clauses.push(`a.start_time <= ?${binds.length}`); }

  const rows = await env.DB.prepare(
    `SELECT t.tag AS tag, COUNT(*) AS n
     FROM activity_tags t
     JOIN activities a ON a.id = t.activity_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY t.tag
     ORDER BY n DESC`,
  )
    .bind(...binds)
    .all<{ tag: string; n: number }>();

  const counts: Record<string, number> = {};
  for (const r of rows.results ?? []) counts[r.tag] = r.n;
  return { counts };
}

async function similarIntervals(
  args: Record<string, unknown>,
  env: Env,
  user: User,
) {
  const pace = Number(args.pace_s_per_km);
  if (!Number.isFinite(pace) || pace <= 0) throw new Error("pace_s_per_km required");
  const bucket = String(args.distance_bucket ?? "");
  if (!bucket) throw new Error("distance_bucket required");
  const load = (String(args.load ?? "moderate") as LoadCategory);
  const tolerance = Number(args.tolerance_s ?? 15);
  const z2 = Number(args.z2_ceiling ?? 140);
  const withinDays = Number(args.within_days);

  const clauses = ["user_id = ?1"];
  const binds: unknown[] = [user.id];
  if (Number.isFinite(withinDays) && withinDays > 0) {
    const cutoff = new Date(Date.now() - withinDays * 86400 * 1000).toISOString();
    binds.push(cutoff);
    clauses.push(`start_time >= ?${binds.length}`);
  }

  const rows = await env.DB.prepare(
    `SELECT id, file_name, start_time, json_r2_key
     FROM activities
     WHERE ${clauses.join(" AND ")}
     ORDER BY COALESCE(start_time, '') DESC
     LIMIT 500`,
  )
    .bind(...binds)
    .all<{ id: string; file_name: string; start_time: string | null; json_r2_key: string }>();

  const metas = rows.results ?? [];

  const activities = await Promise.all(
    metas.map(async (m) => {
      try {
        const obj = await env.FIT_BUCKET.get(m.json_r2_key);
        if (!obj) return null;
        const parsed = (await obj.json()) as { segments?: unknown };
        const segments = Array.isArray(parsed.segments)
          ? (parsed.segments as Array<Record<string, unknown>>).map((s) => ({
              avgSpeed: num(s.avgSpeed),
              avgHeartRate: num(s.avgHeartRate),
              totalDistance: num(s.totalDistance) ?? 0,
            }))
          : [];
        return {
          id: m.id,
          fileName: m.file_name,
          startTime: m.start_time,
          segments,
        };
      } catch {
        return null;
      }
    }),
  );

  const matches = findMatches(
    activities.filter(Boolean) as NonNullable<(typeof activities)[number]>[],
    {
      pace_s_per_km: pace,
      distance_bucket: bucket as Reference["distance_bucket"],
      load,
      tolerance_s: tolerance,
    },
    z2,
  );

  return {
    reference: {
      pace_s_per_km: pace,
      distance_bucket: bucket,
      load,
      tolerance_s: tolerance,
    },
    matches,
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
