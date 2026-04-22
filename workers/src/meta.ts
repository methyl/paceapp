/**
 * Flexible metadata extracted from a parsed ParsedActivity JSON. Persisted
 * as a JSON blob in `activities.meta`, with the schema version persisted
 * alongside it as the indexed `meta_version` column. Bump META_VERSION when
 * deriveMeta's output shape changes — the backfill sweep will re-derive
 * every row whose stored meta_version is behind.
 */
export const META_VERSION = 3;

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

/**
 * Accumulated ascent/descent from altitude records. Raw sum-of-positive-deltas
 * is very noise-sensitive: a flat urban 7 km at 1 Hz with ±1 m GPS altitude
 * jitter will register 100+ m of "ascent" even when you never climbed a step.
 * Two-stage smoothing before accumulation makes the value match how a human
 * would score the terrain:
 *
 * 1. Running-mean smoothing over a ~30-sample window suppresses per-sample
 *    jitter.
 * 2. A minimum-delta gate (0.5 m) below which we ignore micro-oscillations,
 *    so flat stretches don't slowly accrue phantom ascent.
 */
const SMOOTH_WINDOW = 30;
const MIN_DELTA_M = 0.5;

function elevationFromRecords(
  records: Array<{ altitude?: number }> | undefined,
): { ascent: number | null; descent: number | null } {
  if (!Array.isArray(records) || records.length < 2) {
    return { ascent: null, descent: null };
  }
  const alts: number[] = [];
  for (const r of records) {
    const a = r?.altitude;
    if (typeof a === "number" && Number.isFinite(a)) alts.push(a);
  }
  if (alts.length < SMOOTH_WINDOW) return { ascent: null, descent: null };

  // Centered running mean.
  const smoothed: number[] = new Array(alts.length);
  const half = Math.floor(SMOOTH_WINDOW / 2);
  let sum = 0;
  for (let i = 0; i < Math.min(SMOOTH_WINDOW, alts.length); i++) sum += alts[i];
  for (let i = 0; i < alts.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(alts.length, i + half + 1);
    let windowSum = 0;
    for (let j = lo; j < hi; j++) windowSum += alts[j];
    smoothed[i] = windowSum / (hi - lo);
  }

  // Accumulate only deltas that exceed the minimum-delta gate — keeps
  // noise-equivalent wobble from drifting ascent upward.
  let ascent = 0;
  let descent = 0;
  let ref = smoothed[0];
  for (let i = 1; i < smoothed.length; i++) {
    const d = smoothed[i] - ref;
    if (d >= MIN_DELTA_M) {
      ascent += d;
      ref = smoothed[i];
    } else if (d <= -MIN_DELTA_M) {
      descent -= d;
      ref = smoothed[i];
    }
  }
  return { ascent, descent };
}
