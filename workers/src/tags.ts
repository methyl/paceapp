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
  laps: LapSummary[];
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

const HILLY_ASCENT_PER_KM = 10;

export function deriveTags(input: DeriveTagsInput): string[] {
  const tags = new Set<string>();

  const intensity = classifyIntensity(input);
  if (intensity) tags.add(intensity);

  const fastSegs = findFastReps(input.laps);
  if (fastSegs.length >= 2) {
    tags.add("intervals");
    if (areRepsShortStrides(fastSegs)) tags.add("strides");
    if (areRepsUphill(fastSegs, input.records)) tags.add("hill-intervals");

    // Hard reps @ Z5 effort — refine intensity by rep duration.
    const avgDur = mean(fastSegs.map((s) => s.totalElapsedTime));
    if (intensity === "vo2" && avgDur > 0 && avgDur < 45) {
      tags.delete("vo2");
      tags.add("anaerobic");
    }
  }

  if (isProgressive(input.laps)) tags.add("progressive");

  if (isHilly(input.totalDistance, input.totalAscent)) tags.add("hilly");

  if (isRace(input, intensity, fastSegs.length)) tags.add("race");

  if (tags.size === 0) tags.add("other");
  return [...tags];
}

function classifyIntensity(
  input: DeriveTagsInput,
): "easy" | "steady" | "tempo" | "threshold" | "vo2" | "anaerobic" | null {
  const { zones, laps } = input;
  const z3_mid = (zones.z2_max + zones.z3_max) / 2;

  let totalT = 0;
  let tZ12 = 0;
  let tZ3Lo = 0;
  let tZ3Hi = 0;
  let tZ4 = 0;
  let tZ5 = 0;

  for (const lap of laps) {
    const t = lap.totalElapsedTime;
    if (!(t > 0)) continue;
    totalT += t;
    const hr = lap.avgHeartRate;
    if (hr == null) { tZ12 += t; continue; }
    if (hr <= zones.z2_max)      tZ12 += t;
    else if (hr <= z3_mid)       tZ3Lo += t;
    else if (hr <= zones.z3_max) tZ3Hi += t;
    else if (hr <= zones.z4_max) tZ4 += t;
    else                         tZ5 += t;
  }

  if (totalT === 0) return null;
  const r = (x: number) => x / totalT;

  if (r(tZ5) >= 0.30) return "vo2";
  if (r(tZ4) >= 0.30) return "threshold";
  if (r(tZ3Hi) >= 0.30) return "tempo";
  if (r(tZ3Lo) >= 0.30) return "steady";
  if (r(tZ12) >= 0.60) return "easy";

  // Mixed profile — pick the hardest zone with meaningful time.
  if (r(tZ5) >= 0.10) return "vo2";
  if (r(tZ4) >= 0.15) return "threshold";
  if (r(tZ3Hi) >= 0.15) return "tempo";
  if (r(tZ3Lo) >= 0.15) return "steady";
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
