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

  // Check if most laps are close to 1km (or 1 mile = 1609m)
  const near1k = distances.filter((d) => d > 850 && d < 1150).length;
  const near1mi = distances.filter((d) => d > 1500 && d < 1720).length;

  // If >70% of laps are same-ish distance, it's auto-lap
  const threshold = distances.length * 0.7;
  if (near1k >= threshold || near1mi >= threshold) return true;

  // Also check coefficient of variation — very uniform = auto-lap
  const mean = distances.reduce((s, d) => s + d, 0) / distances.length;
  const std = Math.sqrt(
    distances.reduce((s, d) => s + (d - mean) ** 2, 0) / distances.length
  );
  const cv = std / mean;
  return cv < 0.08;
}

/**
 * Detect effort segments from record-level data by finding sustained
 * pace changes. Uses a smoothed speed signal and a state machine that
 * starts a new segment when pace shifts significantly and holds.
 */
export function detectEffortSegments(records: RecordPoint[]): EffortSegment[] {
  if (records.length < 20) return [];

  // 1. Smooth speed with a rolling window (~20s at 1 record/s)
  const windowSize = 15;
  const smoothed = smoothSignal(
    records.map((r) => r.speed ?? 0),
    windowSize
  );

  // 2. Find change points using a threshold-based state machine
  const PACE_THRESHOLD = 0.25; // m/s change (~15s/km at 5:00 pace) to trigger new segment
  const MIN_SEGMENT_DURATION = 45; // seconds — ignore shorter blips
  const MIN_SEGMENT_RECORDS = 20;

  const changePoints: number[] = [0]; // always start at 0
  let segSum = smoothed[0];
  let segCount = 1;

  for (let i = 1; i < smoothed.length; i++) {
    const segAvg = segSum / segCount;
    const diff = Math.abs(smoothed[i] - segAvg);

    // Check if we've sustained a deviation for enough records
    if (diff > PACE_THRESHOLD) {
      // Look ahead to confirm it's sustained
      let sustained = true;
      const lookAhead = Math.min(i + 10, smoothed.length);
      for (let j = i; j < lookAhead; j++) {
        if (Math.abs(smoothed[j] - segAvg) < PACE_THRESHOLD * 0.5) {
          sustained = false;
          break;
        }
      }

      if (sustained && segCount >= MIN_SEGMENT_RECORDS) {
        changePoints.push(i);
        segSum = smoothed[i];
        segCount = 1;
        continue;
      }
    }

    segSum += smoothed[i];
    segCount++;
  }

  // 3. Build segments from change points
  const segments: EffortSegment[] = [];
  for (let s = 0; s < changePoints.length; s++) {
    const startIdx = changePoints[s];
    const endIdx =
      s + 1 < changePoints.length ? changePoints[s + 1] : records.length;
    const segRecords = records.slice(startIdx, endIdx);

    if (segRecords.length < MIN_SEGMENT_RECORDS) continue;

    const elapsed =
      segRecords.length > 1
        ? (new Date(segRecords[segRecords.length - 1].timestamp).getTime() -
            new Date(segRecords[0].timestamp).getTime()) /
          1000
        : 0;

    if (elapsed < MIN_SEGMENT_DURATION) continue;

    const seg = summarizeRecords(segRecords, segments.length + 1, elapsed);
    segments.push(seg);
  }

  // 4. Merge very similar adjacent segments (within 5% speed)
  return mergeSmallSegments(segments);
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
    return valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : undefined;
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

/** Merge adjacent segments with similar pace to avoid over-segmentation */
function mergeSmallSegments(segments: EffortSegment[]): EffortSegment[] {
  if (segments.length <= 1) return segments;

  const merged: EffortSegment[] = [segments[0]];

  for (let i = 1; i < segments.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = segments[i];

    const prevSpeed = prev.avgSpeed ?? 0;
    const currSpeed = curr.avgSpeed ?? 0;

    // Merge if speeds are within 5% of each other
    if (
      prevSpeed > 0 &&
      currSpeed > 0 &&
      Math.abs(currSpeed - prevSpeed) / prevSpeed < 0.05
    ) {
      // Combine into previous
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

  // Re-index
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
    // Only use detected segments if we found a meaningful structure
    // (more than 1 segment = actual effort changes found)
    if (detected.length > 1) {
      return detected;
    }
  }

  // Fall back to original laps
  return laps.map((l) => ({ ...l, detected: false }));
}
