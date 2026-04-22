import type { Env } from "./env";
import { type HrZones, parseZones, fallbackZones } from "./zones";

/**
 * Returns the user's configured zones, or the fallback zones when the
 * column is NULL / malformed. Callers that need the "is this explicit
 * or derived?" distinction should query `users.hr_zones` directly.
 */
export async function loadUserZones(env: Env, userId: string): Promise<HrZones> {
  const row = await env.DB.prepare("SELECT hr_zones FROM users WHERE id = ?1")
    .bind(userId)
    .first<{ hr_zones: string | null }>();
  return parseZones(row?.hr_zones) ?? fallbackZones();
}

export async function saveUserZones(
  env: Env,
  userId: string,
  zones: HrZones | null,
): Promise<void> {
  await env.DB.prepare("UPDATE users SET hr_zones = ?1 WHERE id = ?2")
    .bind(zones ? JSON.stringify(zones) : null, userId)
    .run();
}

/**
 * After zones change, mark every activity meta_version as NULL so the
 * backfill worker's next sweep re-derives meta + tags with the new
 * zones. Activity tags are left in place until the worker overwrites
 * them — brief period of slightly-stale tags, but no gap in chip counts.
 */
export async function invalidateUserMeta(env: Env, userId: string): Promise<void> {
  await env.DB.prepare("UPDATE activities SET meta_version = NULL WHERE user_id = ?1")
    .bind(userId)
    .run();
}

/**
 * Kicks the backfill worker's /sweep endpoint over the service binding.
 * The worker runs its own sweep query and enqueues stale rows; the user
 * sees recomputed tags in seconds instead of waiting on the 5-minute
 * cron. Errors are logged but not thrown — the cron is a safety net.
 */
export async function triggerSweep(env: Env): Promise<void> {
  try {
    const res = await env.META_BACKFILL_SVC.fetch("https://meta-backfill/sweep", {
      method: "POST",
      headers: { authorization: `Bearer ${env.SWEEP_SECRET}` },
    });
    if (!res.ok) {
      console.warn(`triggerSweep: ${res.status} ${await res.text()}`);
    }
  } catch (e) {
    console.warn(`triggerSweep failed: ${(e as Error).message}`);
  }
}
