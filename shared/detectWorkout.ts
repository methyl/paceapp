import type { LapSummary, ActivitySummary, WorkoutType, HrZones } from "./types";

export const DEFAULT_Z2_CEILING = 140;

/**
 * Default zones when the user hasn't configured any. Anchors the four
 * boundaries at the conventional easy/steady/tempo/threshold ratios off
 * DEFAULT_Z2_CEILING. Callers with explicit zones (e.g. the server with
 * the user's saved hr_zones) should pass those directly.
 */
export function defaultZonesFromAnchor(z2Ceiling: number): HrZones {
  return {
    z1_max: Math.round(z2Ceiling * 1.00),
    z2_max: Math.round(z2Ceiling * 1.08),
    z3_max: Math.round(z2Ceiling * 1.16),
    z4_max: Math.round(z2Ceiling * 1.25),
  };
}

/**
 * Detect workout type using HR zones and pace patterns.
 *
 * Priority:
 * 1. Intervals: actual pace variation with alternating fast/slow pattern
 * 2. Progressive: pace consistently increasing through the run
 * 3. Zone-based classification for steady efforts:
 *    - Easy: majority HR ≤ zones.z1_max
 *    - Steady: majority HR in z1_max..z2_max
 *    - Tempo: majority HR in z2_max..z3_max
 *    - Race: majority HR > z3_max
 *
 * Pure function — caller supplies zones so this runs unchanged on
 * the server. The frontend wraps it with a localStorage-backed default.
 */
export function detectWorkoutType(
  _summary: ActivitySummary,
  laps: LapSummary[],
  zones: HrZones = defaultZonesFromAnchor(DEFAULT_Z2_CEILING),
): WorkoutType {
  const meaningful = laps.filter(
    (l) => l.totalDistance > 50 && l.avgSpeed != null && l.avgSpeed > 0
  );
  if (meaningful.length < 2) return "unknown";

  const speeds = meaningful.map((l) => l.avgSpeed!);
  const cv = coefficientOfVariation(speeds);

  // --- Intervals first: high pace variation with alternating pattern ---
  // Check before zone classification because strides/short intervals
  // have low overall HR (most time in recovery) but clear pace structure.
  if (cv > 0.12 && meaningful.length >= 4 && hasAlternatingPattern(speeds)) {
    // Only classify as intervals if the structured portion is a significant
    // part of the workout. Strides tacked onto a long easy run shouldn't
    // override the workout type — the label captures them instead.
    const meanSpeed = mean(speeds);
    const fastDist = meaningful
      .filter((l) => l.avgSpeed! > meanSpeed * 1.1)
      .reduce((s, l) => s + l.totalDistance, 0);
    const totalDist = meaningful.reduce((s, l) => s + l.totalDistance, 0);
    if (fastDist / totalDist > 0.15) {
      return "intervals";
    }
  }

  // --- Zone-based classification: HR is the most reliable signal ---
  const lapsWithHR = meaningful.filter((l) => l.avgHeartRate != null);

  if (lapsWithHR.length >= 2) {
    const zoneType = classifyByZone(meaningful, zones);
    // If HR clearly says easy, trust it over pace patterns
    if (zoneType === "easy") return "easy";
    // If pace is steady (low CV), trust zone classification over pace patterns
    if (cv < 0.06) return zoneType;
  }

  // --- Progressive: pace must have meaningful and consistent increase ---
  if (cv > 0.05 && meaningful.length >= 3 && isProgressivePace(speeds)) {
    return "progressive";
  }

  // --- Zone-based for non-easy types ---
  if (lapsWithHR.length >= 2) {
    return classifyByZone(meaningful, zones);
  }

  // Fallback: low pace variation = easy, otherwise unknown
  if (cv < 0.10) return "easy";
  return "unknown";
}

/**
 * Classify a run by aggregating lap-time across three intensity bands
 * that map onto the user's physical zones:
 *
 *   easy  = Z1 + Z2   (HR ≤ z2_max)           — aerobic base, most runs
 *   tempo = Z3        (z2_max < HR ≤ z3_max)  — threshold work
 *   race  = Z4 + Z5   (HR > z3_max)           — above threshold
 *
 * "steady" is what we call the mixed profile: substantial time in both
 * easy AND tempo, neither dominating. A run that sits at the aerobic
 * threshold (mostly Z2 with drift into Z3) reads as steady — marathon
 * pace territory.
 */
function classifyByZone(laps: LapSummary[], zones: HrZones): WorkoutType {
  let easyTime = 0;
  let tempoTime = 0;
  let raceTime = 0;
  let totalTime = 0;

  for (const lap of laps) {
    const hr = lap.avgHeartRate;
    const t = lap.totalElapsedTime;
    if (!(t > 0)) continue;
    totalTime += t;

    if (hr == null || hr <= zones.z2_max) {
      easyTime += t;   // Z1 + Z2 → easy aerobic
    } else if (hr <= zones.z3_max) {
      tempoTime += t;  // Z3 → tempo/threshold
    } else {
      raceTime += t;   // Z4 + Z5 → race / above-threshold
    }
  }

  if (totalTime === 0) return "unknown";

  const easyRatio = easyTime / totalTime;
  const tempoRatio = tempoTime / totalTime;
  const raceRatio = raceTime / totalTime;

  if (raceRatio >= 0.40) return "race";
  if (tempoRatio >= 0.55) return "tempo";
  // "easy" requires time almost entirely in Z1+Z2. Any meaningful drift
  // into Z3 flips the classification to "steady" (marathon pace /
  // aerobic threshold effort), so a 2026-04-04-style 10k with HR
  // 127-153 reads as steady rather than easy.
  if (easyRatio >= 0.90) return "easy";
  if (easyRatio > 0 && (tempoRatio > 0 || raceRatio > 0)) return "steady";
  return "easy";
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function coefficientOfVariation(arr: number[]): number {
  const m = mean(arr);
  if (m === 0) return 0;
  return stddev(arr) / m;
}

function hasAlternatingPattern(speeds: number[]): boolean {
  const m = mean(speeds);
  const above = speeds.map((s) => s > m);
  let alternations = 0;
  for (let i = 1; i < above.length; i++) {
    if (above[i] !== above[i - 1]) alternations++;
  }
  return alternations / (above.length - 1) >= 0.6;
}

function isProgressivePace(speeds: number[]): boolean {
  let fasterCount = 0;
  for (let i = 1; i < speeds.length; i++) {
    if (speeds[i] > speeds[i - 1] * 0.99) fasterCount++;
  }
  return fasterCount / (speeds.length - 1) >= 0.7;
}
