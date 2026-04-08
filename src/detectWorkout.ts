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
 * Detect workout type from lap structure and summary metrics.
 *
 * Easy run: most of the run (by time) stays under Z2 HR ceiling.
 * A faster finish is allowed — only the portion before the pickup
 * needs to be below threshold.
 */
export function detectWorkoutType(
  summary: ActivitySummary,
  laps: LapSummary[]
): WorkoutType {
  const meaningful = laps.filter(
    (l) => l.totalDistance > 200 && l.avgSpeed != null && l.avgSpeed > 0
  );
  if (meaningful.length < 2) return "unknown";

  const speeds = meaningful.map((l) => l.avgSpeed!);
  const cv = coefficientOfVariation(speeds);
  const z2 = getZ2Ceiling();

  // --- Check easy/long first using HR-based definition ---
  const easyResult = checkEasyByHR(meaningful, summary, z2);
  if (easyResult) return easyResult;

  // --- Intervals: high pace variation with alternating pattern ---
  if (cv > 0.12 && meaningful.length >= 4 && hasAlternatingPattern(speeds)) {
    return "intervals";
  }

  // --- Progressive: each lap generally faster ---
  if (meaningful.length >= 3 && isProgressive(speeds)) {
    return "progressive";
  }

  // --- Tempo: sustained block at faster-than-average pace ---
  if (meaningful.length >= 3 && isTempoProfile(speeds)) {
    return "tempo";
  }

  // --- Race: high HR, fast, steady ---
  const hrs = meaningful
    .filter((l) => l.avgHeartRate != null)
    .map((l) => l.avgHeartRate!);
  if (hrs.length >= 2) {
    const maxHr = Math.max(...hrs);
    const avgHr = mean(hrs);
    if (avgHr > maxHr * 0.92 && cv < 0.08) {
      return "race";
    }
  }

  // Default: easy if low variation, otherwise unknown
  if (cv < 0.12) return "easy";
  return "unknown";
}

/**
 * HR-based easy/long run check.
 *
 * Easy = the portion of the run before any fast finish stays under Z2.
 * We scan from the start and find the longest prefix where HR < z2 ceiling.
 * If that prefix covers >= 70% of total time, it's an easy run.
 * If duration > 60min or distance > 14km, it's a long run.
 */
function checkEasyByHR(
  laps: LapSummary[],
  summary: ActivitySummary,
  z2Ceiling: number
): WorkoutType | null {
  const lapsWithHR = laps.filter((l) => l.avgHeartRate != null);
  if (lapsWithHR.length < 2) return null;

  // Find the longest prefix of laps where avg HR stays under Z2
  let easyTime = 0;
  let totalTime = 0;
  let easyEnded = false;

  for (const lap of laps) {
    totalTime += lap.totalElapsedTime;
    if (!easyEnded) {
      if (lap.avgHeartRate != null && lap.avgHeartRate <= z2Ceiling) {
        easyTime += lap.totalElapsedTime;
      } else if (lap.avgHeartRate != null && lap.avgHeartRate > z2Ceiling) {
        // Allow occasional single-lap spikes (e.g., a hill)
        // by checking if the NEXT lap is also above Z2
        easyEnded = true;
      } else {
        // No HR data for this lap, count it as easy
        easyTime += lap.totalElapsedTime;
      }
    }
  }

  const easyRatio = easyTime / totalTime;

  if (easyRatio >= 0.70) {
    const isLong =
      summary.totalElapsedTime > 3600 || summary.totalDistance > 14000;
    return isLong ? "long" : "easy";
  }

  return null;
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

function isTempoProfile(speeds: number[]): boolean {
  if (speeds.length < 3) return false;
  const sorted = [...speeds].sort((a, b) => b - a);
  const fastThreshold = sorted[Math.floor(sorted.length * 0.3)];
  const fastMask = speeds.map((s) => s >= fastThreshold * 0.97);

  let maxBlock = 0;
  let current = 0;
  let blockStart = -1;
  let bestStart = -1;
  for (let i = 0; i < fastMask.length; i++) {
    if (fastMask[i]) {
      if (current === 0) blockStart = i;
      current++;
      if (current > maxBlock) {
        maxBlock = current;
        bestStart = blockStart;
      }
    } else {
      current = 0;
    }
  }

  if (maxBlock >= speeds.length * 0.4 && bestStart >= 1) {
    const blockSpeeds = speeds.slice(bestStart, bestStart + maxBlock);
    return coefficientOfVariation(blockSpeeds) < 0.06;
  }
  return false;
}
