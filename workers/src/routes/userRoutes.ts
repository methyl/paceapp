import type { Env } from "../env";
import { json, error } from "../http";
import { getUserFromRequest } from "../auth";
import { type HrZones, parseZones, fallbackZones, deriveZonesFromActivities } from "../zones";
import { saveUserZones, invalidateUserMeta } from "../zones_io";

interface SettingsBody {
  hr_zones?: HrZones | null; // null ⇒ reset to auto-derive
}

/**
 * GET /api/user/settings
 * Returns the user's explicit zone config (or null if auto-derived) and
 * the effective zones after fallback, so the UI can show both "yours" and
 * "what we're actually using right now".
 */
export async function getSettings(req: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(req, env);
  if (!user) return error(401, "not authenticated");

  const row = await env.DB.prepare("SELECT hr_zones FROM users WHERE id = ?1")
    .bind(user.id)
    .first<{ hr_zones: string | null }>();
  const explicit = parseZones(row?.hr_zones);
  const effective = explicit ?? fallbackZones();
  return json({ hr_zones: explicit, effective_zones: effective });
}

/**
 * PATCH /api/user/settings
 * Body: { hr_zones: HrZones | null }
 * Passing null clears the config and reverts to auto-derive.
 */
export async function patchSettings(req: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(req, env);
  if (!user) return error(401, "not authenticated");

  let body: SettingsBody;
  try {
    body = await req.json();
  } catch {
    return error(400, "invalid json");
  }

  let next: HrZones | null = null;
  if (body.hr_zones === null) {
    next = null;
  } else if (body.hr_zones && typeof body.hr_zones === "object") {
    const z = body.hr_zones;
    if (
      !Number.isFinite(z.z1_max) || !Number.isFinite(z.z2_max) ||
      !Number.isFinite(z.z3_max) || !Number.isFinite(z.z4_max)
    ) return error(400, "hr_zones must be four finite numbers");
    if (!(z.z1_max < z.z2_max && z.z2_max < z.z3_max && z.z3_max < z.z4_max)) {
      return error(400, "hr_zones must be strictly ascending");
    }
    next = { z1_max: z.z1_max, z2_max: z.z2_max, z3_max: z.z3_max, z4_max: z.z4_max };
  } else {
    return error(400, "hr_zones required (object or null)");
  }

  await saveUserZones(env, user.id, next);
  await invalidateUserMeta(env, user.id);

  return json({ ok: true, hr_zones: next, effective_zones: next ?? fallbackZones() });
}

/**
 * POST /api/user/settings/auto-zones
 * Pulls HR samples from the user's most recent activities, estimates
 * zones, and persists them. Returns the derived zones without applying
 * them until the user confirms via PATCH — avoids surprise overwrites.
 */
export async function autoZones(req: Request, env: Env): Promise<Response> {
  const user = await getUserFromRequest(req, env);
  if (!user) return error(401, "not authenticated");

  const recent = await env.DB.prepare(
    `SELECT json_r2_key, total_elapsed_time
     FROM activities
     WHERE user_id = ?1
     ORDER BY COALESCE(start_time, '') DESC
     LIMIT 50`,
  )
    .bind(user.id)
    .all<{ json_r2_key: string; total_elapsed_time: number | null }>();

  const hrSamples: number[] = [];
  const sustainedHardAvgHrs: number[] = [];

  for (const row of recent.results ?? []) {
    try {
      const obj = await env.FIT_BUCKET.get(row.json_r2_key);
      if (!obj) continue;
      const parsed = (await obj.json()) as {
        records?: Array<{ heartRate?: number }>;
        summary?: { avgHeartRate?: number };
        laps?: Array<{ avgHeartRate?: number; totalElapsedTime?: number }>;
      };
      for (const r of parsed.records ?? []) {
        if (typeof r?.heartRate === "number" && r.heartRate > 60) hrSamples.push(r.heartRate);
      }
      // Sustained-hard proxy: activities lasting ≥20 min whose avg HR is
      // in the top slice of the user's own distribution. We don't know
      // the zones yet, so use a distribution cut later — here we just
      // collect candidates with avg HR ≥ 150 as a coarse pre-filter.
      const dur = row.total_elapsed_time ?? 0;
      const avgHr = parsed.summary?.avgHeartRate;
      if (dur >= 1200 && typeof avgHr === "number" && avgHr >= 150) {
        sustainedHardAvgHrs.push(avgHr);
      }
    } catch {
      continue;
    }
  }

  const derived = deriveZonesFromActivities(hrSamples, sustainedHardAvgHrs);
  return json({
    derived_zones: derived,
    hr_sample_count: hrSamples.length,
    hard_effort_count: sustainedHardAvgHrs.length,
  });
}
