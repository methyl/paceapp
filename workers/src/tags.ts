import type { HrZones } from "./zones";

/**
 * Multi-tag workout classification. A single activity can carry tags from
 * four orthogonal dimensions:
 *
 *   intensity   (≤1): easy | steady | tempo | threshold | vo2 | anaerobic
 *   structure   (≥0): intervals | progressive | strides | hill-intervals
 *   terrain     (≥0): hilly
 *   context     (≥0): race
 *
 * A hilly tempo on a 10k route → [tempo, hilly].
 * A 10×30s hill sprint session → [hill-intervals, anaerobic, hilly].
 * A 5k race                    → [race, vo2].
 *
 * Thresholds are tuned to be permissive on the "add the tag" side — we'd
 * rather surface a false-positive hilly run than hide real hill work.
 */

export interface DeriveTagsInput {
  zones: HrZones;
  /** Native FIT laps — drives intensity classification so the result
   *  matches the client-side detector one-for-one. */
  laps: LapSummary[];
  /** Effort-detected segments (set to laps when the client didn't
   *  detect any). Drives interval/strides/hill-intervals detection. */
  segments: LapSummary[];
  records: RecordPoint[];
  totalDistance: number;
  totalAscent: number | null;
}

export interface LapSummary {
  totalDistance: number;
  totalElapsedTime: number;
  avgHeartRate?: number;
  avgSpeed?: number;
  startTime?: string;
}

export interface RecordPoint {
  timestamp?: string;
  altitude?: number;
}

// Post-smoothing threshold. A genuinely hilly road run sits at 15-25 m/km;
// rolling terrain without sustained climbs typically under 10. Combined
// with the smoothing in deriveMeta this keeps flat-but-noisy activities
// from tagging as hilly.
const HILLY_ASCENT_PER_KM = 15;
const HILLY_MIN_TOTAL_ASCENT_M = 100;

export function deriveTags(input: DeriveTagsInput): string[] {
  const tags = new Set<string>();

  // Interval/strides/hill-intervals detection runs over effort-segments
  // (finer-grained than native laps when autodetected).
  const fastSegs = findFastReps(input.segments);
  const isStrides = fastSegs.length >= 2 && areRepsShortStrides(fastSegs);

  // Intensity classification runs over native FIT laps so it agrees
  // with the client's detectWorkoutType, which uses the same input. For
  // strides workouts we additionally drop any lap whose effort window
  // overlaps the detected strides — a 15s burst inside an otherwise
  // easy km shouldn't drag the km-lap into "steady".
  const baseLaps = isStrides
    ? filterOutStrideLaps(input.laps, fastSegs)
    : input.laps;
  const intensity = classifyIntensity({ ...input, laps: baseLaps });
  if (intensity) tags.add(intensity);

  if (fastSegs.length >= 2) {
    // Strides and intervals are mutually exclusive labels — strides is
    // a specific subtype of interval-like structure, not an additional
    // modifier on top of "intervals".
    if (isStrides) tags.add("strides");
    else tags.add("intervals");
    if (areRepsUphill(fastSegs, input.records)) tags.add("hill-intervals");

    // Hard reps @ Z5 effort — refine intensity by rep duration.
    const avgDur = mean(fastSegs.map((s) => s.totalElapsedTime));
    if (intensity === "vo2" && avgDur > 0 && avgDur < 45) {
      tags.delete("vo2");
      tags.add("anaerobic");
    }
  }

  // Progressive looks at a whole-run trend — strides at the end would
  // always trip it, so we use the stride-free laps here too.
  if (isProgressive(baseLaps)) tags.add("progressive");

  if (isHilly(input.totalDistance, input.totalAscent)) tags.add("hilly");

  if (isRace(input, intensity, fastSegs.length)) tags.add("race");

  if (tags.size === 0) tags.add("other");
  return [...tags];
}

function classifyIntensity(
  input: DeriveTagsInput,
): "easy" | "steady" | "tempo" | "threshold" | "vo2" | "anaerobic" | null {
  const { zones, laps } = input;

  let totalT = 0;
  let tEasy = 0;
  let tSteady = 0;
  let tTempo = 0;
  let tThreshold = 0;
  let tVo2 = 0;

  for (const lap of laps) {
    const t = lap.totalElapsedTime;
    if (!(t > 0)) continue;
    totalT += t;
    const hr = lap.avgHeartRate;
    if (hr == null) { tEasy += t; continue; }
    if (hr <= zones.z1_max)      tEasy += t;
    else if (hr <= zones.z2_max) tSteady += t;
    else if (hr <= zones.z3_max) tTempo += t;
    else if (hr <= zones.z4_max) tThreshold += t;
    else                         tVo2 += t;
  }

  if (totalT === 0) return null;
  const r = (x: number) => x / totalT;

  // Clear-dominance thresholds mirror the client's classifyByZone: a
  // majority of easy time wins unless harder zones accumulate enough
  // time to credibly name the session.
  if (r(tEasy) >= 0.60) return "easy";
  if (r(tVo2) >= 0.30) return "vo2";
  if (r(tThreshold) >= 0.35) return "threshold";
  if (r(tTempo) >= 0.40) return "tempo";
  if (r(tSteady) >= 0.35) return "steady";
  if (r(tEasy) + r(tSteady) >= 0.70) return "easy";

  // Mixed profile — pick the hardest zone with meaningful time.
  if (r(tVo2) >= 0.15) return "vo2";
  if (r(tThreshold) >= 0.15) return "threshold";
  if (r(tTempo) >= 0.15) return "tempo";
  if (r(tSteady) > 0) return "steady";
  return "easy";
}

function findFastReps(laps: LapSummary[]): LapSummary[] {
  const meaningful = laps.filter(
    (l) => l.totalDistance > 50 && l.avgSpeed != null && l.avgSpeed > 0,
  );
  if (meaningful.length < 4) return [];

  const speeds = meaningful.map((l) => l.avgSpeed!);
  const cv = coefficientOfVariation(speeds);
  if (cv < 0.08) return [];

  const meanSpeed = mean(speeds);
  const threshold = meanSpeed * 1.05;
  const fast = meaningful.filter((l) => l.avgSpeed! > threshold);
  if (fast.length < 2) return [];

  // Require alternating pattern to avoid labelling a progressive as intervals.
  const above = meaningful.map((l) => l.avgSpeed! > meanSpeed);
  let alternations = 0;
  for (let i = 1; i < above.length; i++) if (above[i] !== above[i - 1]) alternations++;
  if (alternations / (above.length - 1) < 0.5) return [];

  return fast;
}

/**
 * Drop any native lap whose time window overlaps one of the detected
 * stride segments. Autolap splits (per-km) will typically contain a
 * handful of strides within an otherwise easy km — excluding those
 * laps keeps the intensity classification on the true easy portion.
 */
function filterOutStrideLaps(laps: LapSummary[], strides: LapSummary[]): LapSummary[] {
  if (strides.length === 0) return laps;
  const windows: Array<[number, number]> = [];
  for (const s of strides) {
    if (!s.startTime) continue;
    const start = new Date(s.startTime).getTime();
    windows.push([start, start + s.totalElapsedTime * 1000]);
  }
  if (windows.length === 0) return laps;
  return laps.filter((lap) => {
    if (!lap.startTime) return true;
    const lapStart = new Date(lap.startTime).getTime();
    const lapEnd = lapStart + lap.totalElapsedTime * 1000;
    for (const [ws, we] of windows) {
      if (ws < lapEnd && we > lapStart) return false;
    }
    return true;
  });
}

function areRepsShortStrides(fast: LapSummary[]): boolean {
  const avgDist = mean(fast.map((s) => s.totalDistance));
  const avgDur = mean(fast.map((s) => s.totalElapsedTime));
  return avgDist < 300 && avgDur < 60;
}

function areRepsUphill(fast: LapSummary[], records: RecordPoint[]): boolean {
  if (records.length < 10) return false;
  let uphill = 0;
  for (const seg of fast) {
    if (!seg.startTime) continue;
    const segStart = new Date(seg.startTime).getTime();
    const segEnd = segStart + seg.totalElapsedTime * 1000;
    const pts = records.filter((r) => {
      if (!r.timestamp || r.altitude == null) return false;
      const t = new Date(r.timestamp).getTime();
      return t >= segStart && t <= segEnd;
    });
    if (pts.length < 3) continue;
    const gain = pts[pts.length - 1].altitude! - pts[0].altitude!;
    if (gain > 2) uphill++;
  }
  return fast.length >= 2 && uphill / fast.length > 0.6;
}

function isProgressive(laps: LapSummary[]): boolean {
  const speeds = laps
    .filter((l) => l.totalDistance > 50 && l.avgSpeed != null && l.avgSpeed > 0)
    .map((l) => l.avgSpeed!);
  if (speeds.length < 3) return false;
  let faster = 0;
  for (let i = 1; i < speeds.length; i++) {
    if (speeds[i] > speeds[i - 1] * 0.99) faster++;
  }
  return faster / (speeds.length - 1) >= 0.7 && coefficientOfVariation(speeds) > 0.05;
}

function isHilly(totalDistance: number, totalAscent: number | null): boolean {
  if (totalAscent == null || totalDistance < 2000) return false;
  if (totalAscent < HILLY_MIN_TOTAL_ASCENT_M) return false;
  const km = totalDistance / 1000;
  return totalAscent / km >= HILLY_ASCENT_PER_KM;
}

function isRace(
  input: DeriveTagsInput,
  intensity: string | null,
  fastRepCount: number,
): boolean {
  // Heuristic: one sustained hard effort (Z4+ dominant), no interval
  // structure, duration typical for racing.
  if (fastRepCount > 0) return false;
  if (intensity !== "threshold" && intensity !== "vo2") return false;
  const durMin = input.laps.reduce((s, l) => s + l.totalElapsedTime, 0) / 60;
  return durMin >= 8 && durMin <= 240;
}

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function coefficientOfVariation(arr: number[]): number {
  const m = mean(arr);
  if (m === 0) return 0;
  const sd = Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  return sd / m;
}
