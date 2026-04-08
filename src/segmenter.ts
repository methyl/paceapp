import type { RecordPoint, LapSummary } from "./types";
import { speedToPace } from "./parseFit";

export interface EffortSegment {
  lapIndex: number;
  startTime: string;
  totalDistance: number;
  totalElapsedTime: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgCadence?: number;
  avgSpeed?: number;
  avgPace: string;
  avgVerticalOscillation?: number;
  avgGroundContactTime?: number;
  avgGroundContactTimeBalance?: number;
  avgStrideLength?: number;
  avgVerticalRatio?: number;
  avgPower?: number;
  /** true = detected from pace changes, false = original lap */
  detected: boolean;
}

/** Check if laps look like auto-laps (all roughly the same distance) */
export function isAutoLap(laps: LapSummary[]): boolean {
  if (laps.length < 3) return false;

  const distances = laps
    .filter((l) => l.totalDistance > 100)
    .map((l) => l.totalDistance);
  if (distances.length < 3) return false;

  const near1k = distances.filter((d) => d > 850 && d < 1150).length;
  const near1mi = distances.filter((d) => d > 1500 && d < 1720).length;

  const threshold = distances.length * 0.7;
  if (near1k >= threshold || near1mi >= threshold) return true;

  const mean = distances.reduce((s, d) => s + d, 0) / distances.length;
  const std = Math.sqrt(
    distances.reduce((s, d) => s + (d - mean) ** 2, 0) / distances.length
  );
  return std / mean < 0.08;
}

/**
 * Detect effort segments from record-level data, but only keep them
 * if they form a consistent repeating pattern (e.g., intervals with
 * similar fast/slow durations) or a clear warmup/effort/cooldown shape.
 *
 * Random one-off pace wobbles are NOT segmented.
 */
export function detectEffortSegments(records: RecordPoint[]): EffortSegment[] {
  if (records.length < 60) return [];

  // 1. Smooth speed signal
  const smoothed = smoothSignal(
    records.map((r) => r.speed ?? 0),
    15
  );

  // 2. Find raw change points
  const rawSegments = findChangePoints(smoothed, records);
  if (rawSegments.length <= 1) return [];

  // 3. Merge adjacent segments with similar pace
  const merged = mergeSmallSegments(rawSegments);
  if (merged.length <= 1) return [];

  // 4. Validate: only keep if segments form a consistent pattern
  if (hasConsistentPattern(merged)) {
    return merged;
  }

  return [];
}

function findChangePoints(
  smoothed: number[],
  records: RecordPoint[]
): EffortSegment[] {
  const PACE_THRESHOLD = 0.3; // m/s (~18s/km at 5:00 pace)
  const MIN_RECORDS = 25;
  const MIN_DURATION = 50; // seconds

  const changePoints: number[] = [0];
  let segSum = smoothed[0];
  let segCount = 1;

  for (let i = 1; i < smoothed.length; i++) {
    const segAvg = segSum / segCount;
    const diff = Math.abs(smoothed[i] - segAvg);

    if (diff > PACE_THRESHOLD) {
      // Confirm sustained: look ahead 12 records
      let sustained = true;
      const lookAhead = Math.min(i + 12, smoothed.length);
      for (let j = i; j < lookAhead; j++) {
        if (Math.abs(smoothed[j] - segAvg) < PACE_THRESHOLD * 0.4) {
          sustained = false;
          break;
        }
      }

      if (sustained && segCount >= MIN_RECORDS) {
        changePoints.push(i);
        segSum = smoothed[i];
        segCount = 1;
        continue;
      }
    }

    segSum += smoothed[i];
    segCount++;
  }

  // Build segments from change points
  const segments: EffortSegment[] = [];
  for (let s = 0; s < changePoints.length; s++) {
    const startIdx = changePoints[s];
    const endIdx =
      s + 1 < changePoints.length ? changePoints[s + 1] : records.length;
    const segRecords = records.slice(startIdx, endIdx);

    if (segRecords.length < MIN_RECORDS) continue;

    const elapsed =
      segRecords.length > 1
        ? (new Date(segRecords[segRecords.length - 1].timestamp).getTime() -
            new Date(segRecords[0].timestamp).getTime()) /
          1000
        : 0;

    if (elapsed < MIN_DURATION) continue;

    segments.push(summarizeRecords(segRecords, segments.length + 1, elapsed));
  }

  return segments;
}

/**
 * Validate that detected segments form a consistent, repeating pattern.
 *
 * Accepts:
 * 1. Interval pattern: >= 2 fast reps with similar pace AND duration,
 *    interleaved with recovery segments.
 * 2. Tempo/threshold: warmup + sustained block (>= 40% of time) + cooldown,
 *    where the sustained block is clearly faster than bookends.
 */
function hasConsistentPattern(segments: EffortSegment[]): boolean {
  if (segments.length < 3) return false;

  // Classify each segment as fast or slow relative to median speed
  const speeds = segments.map((s) => s.avgSpeed ?? 0).filter((s) => s > 0);
  if (speeds.length < 3) return false;

  const sorted = [...speeds].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const fast = segments.filter(
    (s) => (s.avgSpeed ?? 0) > median * 1.03
  );
  const slow = segments.filter(
    (s) => (s.avgSpeed ?? 0) <= median * 0.97
  );

  // --- Check interval pattern ---
  if (fast.length >= 2 && slow.length >= 1) {
    const fastSpeeds = fast.map((s) => s.avgSpeed!);
    const fastDurations = fast.map((s) => s.totalElapsedTime);

    const speedCV = cv(fastSpeeds);
    const durationCV = cv(fastDurations);

    // Fast reps should be consistent: pace within 10%, duration within 40%
    if (speedCV < 0.10 && durationCV < 0.40) {
      return true;
    }
  }

  // --- Check tempo pattern ---
  // Look for a contiguous block of faster segments in the middle
  const totalTime = segments.reduce((s, seg) => s + seg.totalElapsedTime, 0);
  let bestBlockTime = 0;
  let bestBlockStart = -1;
  let blockTime = 0;
  let blockStart = 0;

  for (let i = 0; i < segments.length; i++) {
    if ((segments[i].avgSpeed ?? 0) > median * 1.02) {
      if (blockTime === 0) blockStart = i;
      blockTime += segments[i].totalElapsedTime;
      if (blockTime > bestBlockTime) {
        bestBlockTime = blockTime;
        bestBlockStart = blockStart;
      }
    } else {
      blockTime = 0;
    }
  }

  // Sustained block covers >= 40% of total time and starts after at least 1 segment
  if (bestBlockTime >= totalTime * 0.35 && bestBlockStart >= 1) {
    return true;
  }

  return false;
}

function cv(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  if (m === 0) return 0;
  const std = Math.sqrt(
    arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length
  );
  return std / m;
}

function smoothSignal(data: number[], windowSize: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(data.length, i + Math.floor(windowSize / 2) + 1);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      if (data[j] > 0) {
        sum += data[j];
        count++;
      }
    }
    result.push(count > 0 ? sum / count : 0);
  }
  return result;
}

function summarizeRecords(
  records: RecordPoint[],
  lapIndex: number,
  elapsed: number
): EffortSegment {
  const avg = (vals: (number | undefined)[]) => {
    const valid = vals.filter((v): v is number => v != null && v > 0);
    return valid.length > 0
      ? valid.reduce((s, v) => s + v, 0) / valid.length
      : undefined;
  };
  const max = (vals: (number | undefined)[]) => {
    const valid = vals.filter((v): v is number => v != null);
    return valid.length > 0 ? Math.max(...valid) : undefined;
  };

  const firstDist = records[0].distance ?? 0;
  const lastDist = records[records.length - 1].distance ?? 0;
  const totalDistance = lastDist - firstDist;
  const avgSpeed = avg(records.map((r) => r.speed));

  return {
    lapIndex,
    startTime: records[0].timestamp,
    totalDistance,
    totalElapsedTime: elapsed,
    avgHeartRate: avg(records.map((r) => r.heartRate)),
    maxHeartRate: max(records.map((r) => r.heartRate)),
    avgCadence: avg(records.map((r) => r.cadence)),
    avgSpeed,
    avgPace: speedToPace(avgSpeed ?? 0),
    avgVerticalOscillation: avg(records.map((r) => r.verticalOscillation)),
    avgGroundContactTime: avg(records.map((r) => r.groundContactTime)),
    avgGroundContactTimeBalance: avg(
      records.map((r) => r.groundContactTimeBalance)
    ),
    avgStrideLength: avg(records.map((r) => r.strideLength)),
    avgVerticalRatio: avg(records.map((r) => r.verticalRatio)),
    avgPower: avg(records.map((r) => r.power)),
    detected: true,
  };
}

/** Merge adjacent segments with similar pace */
function mergeSmallSegments(segments: EffortSegment[]): EffortSegment[] {
  if (segments.length <= 1) return segments;

  const merged: EffortSegment[] = [segments[0]];

  for (let i = 1; i < segments.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = segments[i];

    const prevSpeed = prev.avgSpeed ?? 0;
    const currSpeed = curr.avgSpeed ?? 0;

    if (
      prevSpeed > 0 &&
      currSpeed > 0 &&
      Math.abs(currSpeed - prevSpeed) / prevSpeed < 0.05
    ) {
      const totalTime = prev.totalElapsedTime + curr.totalElapsedTime;
      const w1 = prev.totalElapsedTime / totalTime;
      const w2 = curr.totalElapsedTime / totalTime;

      const wavg = (a: number | undefined, b: number | undefined) =>
        a != null && b != null ? a * w1 + b * w2 : a ?? b;

      prev.totalDistance += curr.totalDistance;
      prev.totalElapsedTime = totalTime;
      prev.avgSpeed = wavg(prev.avgSpeed, curr.avgSpeed);
      prev.avgPace = speedToPace(prev.avgSpeed ?? 0);
      prev.avgHeartRate = wavg(prev.avgHeartRate, curr.avgHeartRate);
      prev.maxHeartRate =
        prev.maxHeartRate != null && curr.maxHeartRate != null
          ? Math.max(prev.maxHeartRate, curr.maxHeartRate)
          : prev.maxHeartRate ?? curr.maxHeartRate;
      prev.avgCadence = wavg(prev.avgCadence, curr.avgCadence);
      prev.avgVerticalOscillation = wavg(
        prev.avgVerticalOscillation,
        curr.avgVerticalOscillation
      );
      prev.avgGroundContactTime = wavg(
        prev.avgGroundContactTime,
        curr.avgGroundContactTime
      );
      prev.avgPower = wavg(prev.avgPower, curr.avgPower);
    } else {
      curr.lapIndex = merged.length + 1;
      merged.push(curr);
    }
  }

  merged.forEach((s, i) => (s.lapIndex = i + 1));
  return merged;
}

/**
 * Get the best segments for analysis: if laps are auto-laps and we have
 * enough records, detect effort segments. Otherwise use original laps.
 */
export function getEffortSegments(
  laps: LapSummary[],
  records: RecordPoint[]
): EffortSegment[] {
  if (isAutoLap(laps) && records.length >= 60) {
    const detected = detectEffortSegments(records);
    if (detected.length > 1) {
      return detected;
    }
  }

  // Fall back to original laps
  return laps.map((l) => ({ ...l, detected: false }));
}
