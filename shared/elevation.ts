// Smoothed ascent/descent from altitude samples.
//
// Raw sum-of-positive-deltas is very noise-sensitive: a flat urban 7 km
// at 1 Hz with ±1 m GPS altitude jitter will register 100+ m of "ascent"
// even when you never climbed a step. Two-stage smoothing before
// accumulation makes the value match how a human would score the terrain:
//
// 1. Running-mean smoothing over a ~30-sample window suppresses per-sample
//    jitter.
// 2. A minimum-delta gate (0.5 m) below which we ignore micro-oscillations,
//    so flat stretches don't slowly accrue phantom ascent.

const SMOOTH_WINDOW = 30;
const MIN_DELTA_M = 0.5;

export function elevationFromAltitudes(
  altitudes: number[],
): { ascent: number; descent: number } | null {
  if (altitudes.length < SMOOTH_WINDOW) return null;

  // Centered running mean.
  const smoothed: number[] = new Array(altitudes.length);
  const half = Math.floor(SMOOTH_WINDOW / 2);
  for (let i = 0; i < altitudes.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(altitudes.length, i + half + 1);
    let windowSum = 0;
    for (let j = lo; j < hi; j++) windowSum += altitudes[j];
    smoothed[i] = windowSum / (hi - lo);
  }

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

export function elevationFromRecords(
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
  const res = elevationFromAltitudes(alts);
  if (!res) return { ascent: null, descent: null };
  return res;
}
