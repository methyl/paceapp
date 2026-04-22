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
