import type { RecordPoint, LapSummary } from "./types";
import { speedFromDistanceTime, speedToPace } from "./pace";

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
 */
export function detectEffortSegments(records: RecordPoint[]): EffortSegment[] {
  if (records.length < 120) return [];

  // 1. Smooth speed signal heavily to avoid noise
  const smoothed = smoothSignal(
    records.map((r) => r.speed ?? 0),
    25
  );

  // 2. Find raw change points with strict thresholds
  const rawSegments = findChangePoints(smoothed, records);
  if (rawSegments.length <= 1) return [];

  // 3. Merge adjacent segments with similar pace
  const merged = mergeSmallSegments(rawSegments);
  if (merged.length <= 1) return [];

  // 4. Drop tiny segments (< 200m and < 90s) — absorb into neighbors
  const substantial = absorbTinySegments(merged);
  if (substantial.length <= 1) return [];

  // 5. Validate: only keep if segments form a consistent pattern
  if (hasConsistentPattern(substantial)) {
    return substantial;
  }

  return [];
}

function findChangePoints(
  smoothed: number[],
  records: RecordPoint[]
): EffortSegment[] {
  const PACE_THRESHOLD = 0.4; // m/s (~25s/km at 5:00 pace)
  const MIN_RECORDS = 30; // ~30s at 1Hz — short fast reps are valid
  const MIN_DURATION = 90; // seconds (overridden by distance >= 200m)

  const changePoints: number[] = [0];
  let segSum = smoothed[0];
  let segCount = 1;

  for (let i = 1; i < smoothed.length; i++) {
    const segAvg = segSum / segCount;
    const diff = Math.abs(smoothed[i] - segAvg);

    if (diff > PACE_THRESHOLD && segCount >= MIN_RECORDS) {
      // Confirm sustained: look ahead 20 records
      let sustained = true;
      const lookAhead = Math.min(i + 20, smoothed.length);
      for (let j = i; j < lookAhead; j++) {
        if (Math.abs(smoothed[j] - segAvg) < PACE_THRESHOLD * 0.4) {
          sustained = false;
          break;
        }
      }

      if (sustained) {
        changePoints.push(i);
        segSum = smoothed[i];
        segCount = 1;
        continue;
      }
    }

    segSum += smoothed[i];
    segCount++;
  }

  const segments: EffortSegment[] = [];
  for (let s = 0; s < changePoints.length; s++) {
    const startIdx = changePoints[s];
    const endIdx =
      s + 1 < changePoints.length ? changePoints[s + 1] : records.length;
    const segRecords = records.slice(startIdx, endIdx);

    const elapsed =
      segRecords.length > 1
        ? (new Date(segRecords[segRecords.length - 1].timestamp).getTime() -
            new Date(segRecords[0].timestamp).getTime()) /
          1000
        : 0;

    const firstDist = segRecords[0].distance ?? 0;
    const lastDist = segRecords[segRecords.length - 1].distance ?? 0;
    const dist = lastDist - firstDist;

    // Keep if substantial by time OR by distance
    if (elapsed < MIN_DURATION && dist < 200) continue;

    segments.push(summarizeRecords(segRecords, segments.length + 1, elapsed));
  }

  return segments;
}

/**
 * Absorb tiny segments (< 200m AND < 90s) into their nearest neighbor
 * by pace similarity, so we don't get micro-fragments.
 */
function absorbTinySegments(segments: EffortSegment[]): EffortSegment[] {
  const MIN_DIST = 200;
  const MIN_TIME = 90;

  const result: EffortSegment[] = [];
  for (const seg of segments) {
    if (seg.totalDistance < MIN_DIST && seg.totalElapsedTime < MIN_TIME && result.length > 0) {
      // Absorb into previous segment
      const prev = result[result.length - 1];
      mergeInto(prev, seg);
    } else {
      result.push({ ...seg });
    }
  }

  // Second pass: absorb any remaining tiny segments at the start
  while (
    result.length > 1 &&
    result[0].totalDistance < MIN_DIST &&
    result[0].totalElapsedTime < MIN_TIME
  ) {
    mergeInto(result[1], result[0]);
    result.shift();
  }

  result.forEach((s, i) => (s.lapIndex = i + 1));
  return result;
}

function mergeInto(target: EffortSegment, source: EffortSegment) {
  const totalTime = target.totalElapsedTime + source.totalElapsedTime;
  const w1 = target.totalElapsedTime / totalTime;
  const w2 = source.totalElapsedTime / totalTime;
  const wavg = (a: number | undefined, b: number | undefined) =>
    a != null && b != null ? a * w1 + b * w2 : a ?? b;

  target.totalDistance += source.totalDistance;
  target.totalElapsedTime = totalTime;
  target.avgSpeed = speedFromDistanceTime(target.totalDistance, totalTime);
  target.avgPace = speedToPace(target.avgSpeed);
  target.avgHeartRate = wavg(target.avgHeartRate, source.avgHeartRate);
  target.maxHeartRate =
    target.maxHeartRate != null && source.maxHeartRate != null
      ? Math.max(target.maxHeartRate, source.maxHeartRate)
      : target.maxHeartRate ?? source.maxHeartRate;
  target.avgCadence = wavg(target.avgCadence, source.avgCadence);
  target.avgVerticalOscillation = wavg(target.avgVerticalOscillation, source.avgVerticalOscillation);
  target.avgGroundContactTime = wavg(target.avgGroundContactTime, source.avgGroundContactTime);
  target.avgPower = wavg(target.avgPower, source.avgPower);
}

/**
 * Validate that detected segments form a consistent, repeating pattern.
 *
 * Accepts:
 * 1. Interval pattern: >= 2 fast reps with consistent pace (CV < 8%),
 *    consistent distance (CV < 30%), AND consistent duration (CV < 30%).
 *    All three must pass — this is the key filter against noise.
 * 2. Tempo/threshold: warmup + single sustained faster block covering
 *    >= 35% of time + cooldown. Max 5 total segments (not choppy).
 */
function hasConsistentPattern(segments: EffortSegment[]): boolean {
  if (segments.length < 3) return false;

  const speeds = segments.map((s) => s.avgSpeed ?? 0).filter((s) => s > 0);
  if (speeds.length < 3) return false;

  const sorted = [...speeds].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Need a meaningful speed spread
  const maxSpeed = Math.max(...speeds);
  const minSpeed = Math.min(...speeds);
  if ((maxSpeed - minSpeed) / median < 0.15) return false;

  const fast = segments.filter(
    (s) => (s.avgSpeed ?? 0) > median * 1.08 && s.totalDistance >= 200
  );

  // --- Check interval pattern ---
  // Need at least 2 fast reps that are truly consistent with each other
  if (fast.length >= 2) {
    const fastSpeeds = fast.map((s) => s.avgSpeed!);
    const fastDurations = fast.map((s) => s.totalElapsedTime);
    const fastDistances = fast.map((s) => s.totalDistance);

    const speedCV = cv(fastSpeeds);
    const durationCV = cv(fastDurations);
    const distanceCV = cv(fastDistances);

    // All three must be consistent — this is strict on purpose.
    // Real intervals (e.g., 4x800m) will have CV < 5% on distance.
    if (speedCV < 0.08 && durationCV < 0.30 && distanceCV < 0.30) {
      return true;
    }
  }

  // --- Check tempo pattern ---
  // Must be a simple structure: warmup + block + cooldown (max 5 segments)
  if (segments.length > 5) return false;

  const totalTime = segments.reduce((s, seg) => s + seg.totalElapsedTime, 0);
  let bestBlockTime = 0;
  let bestBlockStart = -1;
  let blockTime = 0;
  let blockStart = 0;

  for (let i = 0; i < segments.length; i++) {
    if ((segments[i].avgSpeed ?? 0) > median * 1.06) {
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
  // Derive speed from distance/time so pace = time/distance and the two
  // columns stay consistent. Mean of instantaneous record speeds drifts
  // from this and makes pace disagree with time on ~1 km chunks.
  const avgSpeed = speedFromDistanceTime(totalDistance, elapsed);

  return {
    lapIndex,
    startTime: records[0].timestamp,
    totalDistance,
    totalElapsedTime: elapsed,
    avgHeartRate: avg(records.map((r) => r.heartRate)),
    maxHeartRate: max(records.map((r) => r.heartRate)),
    avgCadence: avg(records.map((r) => r.cadence)),
    avgSpeed,
    avgPace: speedToPace(avgSpeed),
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

  const merged: EffortSegment[] = [{ ...segments[0] }];

  for (let i = 1; i < segments.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = segments[i];

    const prevSpeed = prev.avgSpeed ?? 0;
    const currSpeed = curr.avgSpeed ?? 0;

    if (
      prevSpeed > 0 &&
      currSpeed > 0 &&
      Math.abs(currSpeed - prevSpeed) / prevSpeed < 0.07
    ) {
      mergeInto(prev, curr);
    } else {
      merged.push({ ...curr, lapIndex: merged.length + 1 });
    }
  }

  merged.forEach((s, i) => (s.lapIndex = i + 1));
  return merged;
}

const CHUNK_MAX_DISTANCE = 2000; // split segments longer than this
const CHUNK_TARGET_DISTANCE = 1000; // target ~1km chunks
const REP_PEER_TOLERANCE = 0.2; // within 20% = peer rep

/** A segment has a "peer" if another segment has similar distance — i.e., it's a rep. */
function hasRepPeer(seg: EffortSegment, segments: EffortSegment[]): boolean {
  return segments.some(
    (s) =>
      s !== seg &&
      seg.totalDistance > 0 &&
      Math.abs(s.totalDistance - seg.totalDistance) / seg.totalDistance < REP_PEER_TOLERANCE
  );
}

/**
 * Split long solo segments into ~1km chunks using record-level data.
 * Short segments (< 2km) and rep-like segments (similar-distance peers) are
 * left as-is — 3×3km reps stay as three reps, not nine chunks.
 */
function chunkLongSegments(
  segments: EffortSegment[],
  records: RecordPoint[]
): EffortSegment[] {
  if (records.length === 0) return segments;

  const result: EffortSegment[] = [];

  for (const seg of segments) {
    if (seg.totalDistance <= CHUNK_MAX_DISTANCE || hasRepPeer(seg, segments)) {
      result.push(seg);
      continue;
    }

    // Find records belonging to this segment by timestamp range
    const segStart = new Date(seg.startTime).getTime();
    const segEnd = segStart + seg.totalElapsedTime * 1000;
    const segRecords = records.filter((r) => {
      const t = new Date(r.timestamp).getTime();
      return t >= segStart && t <= segEnd;
    });

    if (segRecords.length < 10) {
      result.push(seg);
      continue;
    }

    // Split at every ~1km of distance
    const startDist = segRecords[0].distance;
    const chunks: RecordPoint[][] = [[]];
    let nextSplitDist = startDist + CHUNK_TARGET_DISTANCE;

    for (const rec of segRecords) {
      if (rec.distance >= nextSplitDist && chunks[chunks.length - 1].length >= 5) {
        chunks.push([]);
        nextSplitDist = rec.distance + CHUNK_TARGET_DISTANCE;
      }
      chunks[chunks.length - 1].push(rec);
    }

    // Convert each chunk to a segment
    for (const chunk of chunks) {
      if (chunk.length < 3) continue;
      const first = chunk[0];
      const last = chunk[chunk.length - 1];
      const elapsed =
        (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 1000;
      if (elapsed < 10) continue;
      result.push(summarizeRecords(chunk, 0, elapsed));
    }
  }

  // Re-index
  result.forEach((s, i) => (s.lapIndex = i + 1));
  return result;
}

/**
 * Get the best segments for analysis: if laps are auto-laps and we have
 * enough records, detect effort segments. Otherwise use original laps.
 * Long solo segments (> 2km) are chunked into ~1km pieces; repeated
 * similar-distance segments (reps) are left intact.
 */
export function getEffortSegments(
  laps: LapSummary[],
  records: RecordPoint[]
): EffortSegment[] {
  let segments: EffortSegment[];

  if (isAutoLap(laps) && records.length >= 120) {
    const detected = detectEffortSegments(records);
    if (detected.length > 1) {
      segments = detected;
    } else {
      segments = laps.map((l) => ({ ...l, detected: false }));
    }
  } else {
    segments = laps.map((l) => ({ ...l, detected: false }));
  }

  return chunkLongSegments(segments, records);
}
