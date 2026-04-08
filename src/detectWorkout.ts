import type { LapSummary, ActivitySummary, WorkoutType } from "./types";

const DEFAULT_Z2_CEILING = 140;

export function getZ2Ceiling(): number {
  try {
    const stored = localStorage.getItem("paceapp_z2_ceiling");
    if (stored) return Number(stored);
  } catch {}
  return DEFAULT_Z2_CEILING;
}

export function setZ2Ceiling(value: number) {
  try {
    localStorage.setItem("paceapp_z2_ceiling", String(value));
  } catch {}
}

/**
 * HR zone boundaries derived from Z2 ceiling.
 * Z2 ceiling is the top of zone 2 / aerobic threshold.
 *
 * Approximate zones (using % of max HR, anchored to Z2 ceiling):
 *   Z1-Z2: < z2Ceiling           (easy)
 *   Low Z3: z2Ceiling to +8%     (steady / aerobic)
 *   High Z3: z2Ceiling+8% to +16% (tempo / threshold)
 *   Z4+: > z2Ceiling+16%         (race / VO2max)
 */
function getZones(z2Ceiling: number) {
  return {
    easy: z2Ceiling,              // below this = easy
    steady: z2Ceiling * 1.08,     // Z2 ceiling to this = steady
    tempo: z2Ceiling * 1.16,      // up to this = tempo/threshold
    // above tempo = race/Z4+
  };
}

/**
 * Detect workout type using HR zones and pace patterns.
 *
 * Priority:
 * 1. Intervals: actual pace variation with alternating fast/slow pattern
 * 2. Progressive: pace consistently increasing through the run
 * 3. Zone-based classification for steady efforts:
 *    - Easy: majority HR < Z2 ceiling
 *    - Steady: majority HR in low Z3
 *    - Tempo: majority HR in high Z3
 *    - Race: majority HR in Z4+
 */
export function detectWorkoutType(
  _summary: ActivitySummary,
  laps: LapSummary[]
): WorkoutType {
  const meaningful = laps.filter(
    (l) => l.totalDistance > 200 && l.avgSpeed != null && l.avgSpeed > 0
  );
  if (meaningful.length < 2) return "unknown";

  const speeds = meaningful.map((l) => l.avgSpeed!);
  const cv = coefficientOfVariation(speeds);

  // --- Zone-based classification first: HR is the most reliable signal ---
  const z2 = getZ2Ceiling();
  const zones = getZones(z2);
  const lapsWithHR = meaningful.filter((l) => l.avgHeartRate != null);

  if (lapsWithHR.length >= 2) {
    const zoneType = classifyByZone(meaningful, zones);
    // If HR clearly says easy, trust it over pace patterns
    if (zoneType === "easy") return "easy";
  }

  // --- Intervals: need actual pace alternation, not just uniform laps ---
  if (cv > 0.12 && meaningful.length >= 4 && hasAlternatingPattern(speeds)) {
    return "intervals";
  }

  // --- Progressive: pace consistently increasing ---
  if (meaningful.length >= 3 && isProgressive(speeds)) {
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
 * Classify a run by the HR zone where most time is spent.
 * Scans from start, allowing a fast finish (last ~30% can be harder
 * without changing classification of the main effort).
 */
function classifyByZone(
  laps: LapSummary[],
  zones: { easy: number; steady: number; tempo: number }
): WorkoutType {
  let easyTime = 0;
  let steadyTime = 0;
  let tempoTime = 0;
  let raceTime = 0;
  let totalTime = 0;

  for (const lap of laps) {
    const hr = lap.avgHeartRate;
    const t = lap.totalElapsedTime;
    totalTime += t;

    if (hr == null) {
      easyTime += t; // no HR data, assume easy
    } else if (hr <= zones.easy) {
      easyTime += t;
    } else if (hr <= zones.steady) {
      steadyTime += t;
    } else if (hr <= zones.tempo) {
      tempoTime += t;
    } else {
      raceTime += t;
    }
  }

  if (totalTime === 0) return "unknown";

  // Allow a faster finish: check the main body (first 70%)
  // But also check overall distribution for clear cases
  const easyRatio = easyTime / totalTime;
  const steadyRatio = steadyTime / totalTime;
  const tempoRatio = tempoTime / totalTime;
  const raceRatio = raceTime / totalTime;

  // Majority rules — what zone dominates?
  if (easyRatio >= 0.60) return "easy";
  if (raceRatio >= 0.50) return "race";
  if (tempoRatio >= 0.40) return "tempo";
  if (steadyRatio >= 0.35) return "steady";
  if (easyRatio + steadyRatio >= 0.70) return "easy";

  // Mixed — pick highest non-easy zone
  if (raceRatio >= tempoRatio && raceRatio >= steadyRatio) return "race";
  if (tempoRatio >= steadyRatio) return "tempo";
  if (steadyRatio > 0) return "steady";

  return "unknown";
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

function isProgressive(speeds: number[]): boolean {
  let fasterCount = 0;
  for (let i = 1; i < speeds.length; i++) {
    if (speeds[i] > speeds[i - 1] * 0.99) fasterCount++;
  }
  return fasterCount / (speeds.length - 1) >= 0.7;
}
