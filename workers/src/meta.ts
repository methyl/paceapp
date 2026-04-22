/**
 * Flexible metadata extracted from a parsed ParsedActivity JSON. Persisted
 * as a JSON blob in `activities.meta`. Extend this interface and the logic
 * in `deriveMeta` to add new fields — no schema migration required.
 *
 * Shared between the Pages Functions (upload + MCP) and the standalone
 * backfill worker (workers/backfill).
 */
export interface ActivityMeta {
  workoutLabel?: string;
  totalAscent?: number;
  totalDescent?: number;
}

export function deriveMeta(obj: unknown): ActivityMeta {
  const a = obj as {
    workoutLabel?: string;
    records?: Array<{ altitude?: number }>;
  };
  const meta: ActivityMeta = {};
  if (typeof a?.workoutLabel === "string") meta.workoutLabel = a.workoutLabel;
  const { ascent, descent } = elevationFromRecords(a?.records);
  if (ascent != null) meta.totalAscent = ascent;
  if (descent != null) meta.totalDescent = descent;
  return meta;
}

export function parseMeta(raw: string | null | undefined): ActivityMeta {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as ActivityMeta) : {};
  } catch {
    return {};
  }
}

function elevationFromRecords(
  records: Array<{ altitude?: number }> | undefined,
): { ascent: number | null; descent: number | null } {
  if (!Array.isArray(records) || records.length < 2) {
    return { ascent: null, descent: null };
  }
  let ascent = 0;
  let descent = 0;
  let sawAltitude = false;
  let prev: number | null = null;
  for (const r of records) {
    const a = r?.altitude;
    if (typeof a !== "number" || !Number.isFinite(a)) continue;
    sawAltitude = true;
    if (prev != null) {
      const d = a - prev;
      if (d > 0) ascent += d;
      else descent -= d;
    }
    prev = a;
  }
  if (!sawAltitude) return { ascent: null, descent: null };
  return { ascent, descent };
}
