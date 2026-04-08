import type { LapSummary, ActivitySummary, WorkoutType } from "./types";

/**
 * Detect workout type from lap structure and summary metrics.
 *
 * Heuristics:
 *  - Intervals: bimodal pace distribution with alternating fast/slow pattern
 *  - Tempo: warmup + sustained block at faster pace + optional cooldown
 *  - Progressive: lap paces consistently decrease (getting faster)
 *  - Long Run: easy-like profile but > 60 min or > 14 km
 *  - Easy Run: low pace variation, moderate effort
 *  - Race: high sustained HR (>90% of max observed), low pace variation, fast
 */
export function detectWorkoutType(
  summary: ActivitySummary,
  laps: LapSummary[]
): WorkoutType {
  // Need at least 2 meaningful laps for pattern detection
  const meaningful = laps.filter(
    (l) => l.totalDistance > 200 && l.avgSpeed != null && l.avgSpeed > 0
  );
  if (meaningful.length < 2) return "unknown";

  const speeds = meaningful.map((l) => l.avgSpeed!);
  const hrs = meaningful.filter((l) => l.avgHeartRate != null).map((l) => l.avgHeartRate!);

  const avgSpeed = mean(speeds);
  const cv = coefficientOfVariation(speeds);

  // Check intervals first — high pace variation with alternating pattern
  if (cv > 0.12 && meaningful.length >= 4 && hasAlternatingPattern(speeds)) {
    return "intervals";
  }

  // Check progressive — each lap generally faster than the previous
  if (meaningful.length >= 3 && isProgressive(speeds)) {
    return "progressive";
  }

  // Check tempo — sustained block at faster-than-average pace
  if (meaningful.length >= 3 && isTempoProfile(speeds)) {
    return "tempo";
  }

  // Check long run — steady, long duration or distance
  const isLong =
    summary.totalElapsedTime > 3600 || summary.totalDistance > 14000;
  if (isLong && cv < 0.10) {
    return "long";
  }

  // Check race — high HR, fast, steady
  if (hrs.length >= 2) {
    const maxHr = Math.max(...hrs);
    const avgHr = mean(hrs);
    if (avgHr > maxHr * 0.92 && cv < 0.08 && avgSpeed > mean(speeds) * 0.95) {
      return "race";
    }
  }

  // Default: easy if low variation, otherwise unknown
  if (cv < 0.12) {
    return "easy";
  }

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

/** Check if speeds alternate between fast and slow (interval pattern) */
function hasAlternatingPattern(speeds: number[]): boolean {
  const m = mean(speeds);
  const above = speeds.map((s) => s > m);

  let alternations = 0;
  for (let i = 1; i < above.length; i++) {
    if (above[i] !== above[i - 1]) alternations++;
  }

  // At least 60% of transitions should be alternating
  return alternations / (above.length - 1) >= 0.6;
}

/** Check if paces are progressively getting faster (speed increasing) */
function isProgressive(speeds: number[]): boolean {
  let fasterCount = 0;
  for (let i = 1; i < speeds.length; i++) {
    if (speeds[i] > speeds[i - 1] * 0.99) fasterCount++;
  }
  return fasterCount / (speeds.length - 1) >= 0.7;
}

/**
 * Tempo profile: middle block of laps significantly faster than first/last.
 * Pattern: warmup (1-2 laps) + sustained tempo block + optional cooldown.
 */
function isTempoProfile(speeds: number[]): boolean {
  if (speeds.length < 3) return false;

  const sorted = [...speeds].sort((a, b) => b - a);
  const fastThreshold = sorted[Math.floor(sorted.length * 0.3)];

  const fastMask = speeds.map((s) => s >= fastThreshold * 0.97);

  // Find the longest contiguous block of "fast" laps
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

  // Tempo: sustained block is at least 40% of laps, not starting at lap 0
  // (needs a warmup), and block paces have low variation
  if (maxBlock >= speeds.length * 0.4 && bestStart >= 1) {
    const blockSpeeds = speeds.slice(bestStart, bestStart + maxBlock);
    return coefficientOfVariation(blockSpeeds) < 0.06;
  }

  return false;
}
