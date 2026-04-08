import type { LapSummary } from "./types";
import { getZ2Ceiling } from "./detectWorkout";

/**
 * Standard interval distance buckets.
 * Each has a canonical name and a range (±10%).
 */
const DISTANCE_BUCKETS = [
  { name: "strides", min: 50, max: 150, canonical: 100 },
  { name: "200m", min: 180, max: 220, canonical: 200 },
  { name: "400m", min: 360, max: 440, canonical: 400 },
  { name: "800m", min: 720, max: 880, canonical: 800 },
  { name: "1km", min: 900, max: 1100, canonical: 1000 },
  { name: "2km", min: 1800, max: 2200, canonical: 2000 },
  { name: "4km", min: 3600, max: 4400, canonical: 4000 },
  { name: "5km", min: 4500, max: 5500, canonical: 5000 },
] as const;

export type DistanceBucket = (typeof DISTANCE_BUCKETS)[number]["name"] | null;

/** Match a distance to a standard bucket, or null if no match */
export function getDistanceBucket(distanceMeters: number): DistanceBucket {
  for (const b of DISTANCE_BUCKETS) {
    if (distanceMeters >= b.min && distanceMeters <= b.max) {
      return b.name;
    }
  }
  return null;
}

/** Get the canonical distance for a bucket name */
export function getBucketCanonical(bucket: DistanceBucket): number | null {
  if (!bucket) return null;
  const b = DISTANCE_BUCKETS.find((d) => d.name === bucket);
  return b ? b.canonical : null;
}

function paceStr(speedMps: number): string {
  if (!speedMps || speedMps <= 0) return "";
  const s = 1000 / speedMps;
  return `${Math.floor(s / 60)}:${Math.round(s % 60).toString().padStart(2, "0")}`;
}

function distLabel(meters: number): string {
  if (meters >= 950) return `${(meters / 1000).toFixed(1).replace(/\.0$/, "")}km`;
  return `${Math.round(meters)}m`;
}

interface SegmentBlock {
  type: "easy" | "fast" | "recovery";
  segments: LapSummary[];
  totalDistance: number;
  avgSpeed: number;
  avgHR: number;
  distanceBucket: DistanceBucket;
}

/**
 * Generate a smart training notation label for a workout.
 *
 * Examples:
 *   "10km easy"
 *   "2km easy + 4×1km @3:50 + 2km easy"
 *   "2km easy + 6×400m @1:35 (rec 200m) + 1.5km easy"
 *   "3km easy + 20min tempo @4:30 + 2km easy"
 */
export function generateWorkoutLabel(
  segments: LapSummary[],
  totalDistance: number,
  workoutType: string
): string {
  if (segments.length === 0) {
    return `${distLabel(totalDistance)} ${workoutType}`;
  }

  const z2 = getZ2Ceiling();

  // Classify each segment as easy, fast, or recovery
  const speeds = segments
    .filter((s) => s.avgSpeed && s.avgSpeed > 0)
    .map((s) => s.avgSpeed!);
  if (speeds.length === 0) return `${distLabel(totalDistance)} ${workoutType}`;

  const medianSpeed = [...speeds].sort((a, b) => a - b)[Math.floor(speeds.length / 2)];

  const classified: SegmentBlock[] = [];

  for (const seg of segments) {
    if (!seg.avgSpeed || seg.avgSpeed <= 0) continue;

    const isEasyHR = seg.avgHeartRate != null && seg.avgHeartRate <= z2;
    const isFast = seg.avgSpeed > medianSpeed * 1.08;

    let type: "easy" | "fast" | "recovery";
    if (isFast) {
      type = "fast";
    } else if (isEasyHR) {
      type = "easy";
    } else {
      // Not explicitly fast, not easy HR — classify based on workout type
      type = workoutType === "easy" ? "easy" : "fast";
    }

    const bucket = getDistanceBucket(seg.totalDistance);
    const prev = classified[classified.length - 1];

    // Merge consecutive segments of same type and similar pace
    if (
      prev &&
      prev.type === type &&
      type === "easy" &&
      Math.abs(seg.avgSpeed - prev.avgSpeed) / prev.avgSpeed < 0.12
    ) {
      prev.segments.push(seg);
      prev.totalDistance += seg.totalDistance;
      const n = prev.segments.length;
      prev.avgSpeed = prev.segments.reduce((s, v) => s + (v.avgSpeed ?? 0), 0) / n;
      prev.avgHR = prev.segments.reduce((s, v) => s + (v.avgHeartRate ?? 0), 0) / n;
    } else {
      classified.push({
        type,
        segments: [seg],
        totalDistance: seg.totalDistance,
        avgSpeed: seg.avgSpeed,
        avgHR: seg.avgHeartRate ?? 0,
        distanceBucket: bucket,
      });
    }
  }

  // Now detect repeating fast blocks (intervals)
  // Group consecutive fast+easy pairs into interval sets
  const parts: string[] = [];
  let i = 0;

  while (i < classified.length) {
    const block = classified[i];

    if (block.type === "fast") {
      // Collect consecutive fast reps (possibly with recovery between)
      const reps: SegmentBlock[] = [block];
      let j = i + 1;
      while (j < classified.length) {
        const next = classified[j];
        if (next.type === "fast" && isSimilar(block, next)) {
          reps.push(next);
          j++;
        } else if (
          next.type === "easy" &&
          j + 1 < classified.length &&
          classified[j + 1].type === "fast" &&
          isSimilar(block, classified[j + 1])
        ) {
          // Recovery between reps — skip it, grab next fast
          reps.push(classified[j + 1]);
          j += 2;
        } else {
          break;
        }
      }

      if (reps.length >= 2) {
        // Format as N×dist @pace
        const bucket = reps[0].distanceBucket;
        const dist = bucket ?? distLabel(reps[0].totalDistance);
        const avgPace = paceStr(
          reps.reduce((s, r) => s + r.avgSpeed, 0) / reps.length
        );
        parts.push(`${reps.length}×${dist} @${avgPace}`);
      } else {
        // Single fast block (tempo)
        const dist = block.distanceBucket ?? distLabel(block.totalDistance);
        parts.push(`${dist} @${paceStr(block.avgSpeed)}`);
      }
      i = j;
    } else {
      // Easy block
      parts.push(`${distLabel(block.totalDistance)} easy`);
      i++;
    }
  }

  // Simplify: if the whole thing is one block, use clean label
  if (parts.length === 1 && parts[0].endsWith("easy")) {
    return `${distLabel(totalDistance)} easy`;
  }

  // Steady hard effort (race/tempo) — all segments same pace, no structure
  const allFast = classified.every((b) => b.type === "fast");
  if (allFast && classified.length >= 1) {
    const avgPace = paceStr(
      classified.reduce((s, b) => s + b.avgSpeed, 0) / classified.length
    );
    const TYPE_LABELS: Record<string, string> = {
      race: "race",
      tempo: "tempo",
      steady: "steady",
      progressive: "progressive",
    };
    const typeLabel = TYPE_LABELS[workoutType] ?? "run";
    return `${distLabel(totalDistance)} ${typeLabel} @${avgPace}`;
  }

  return parts.join(" + ");
}

/** Check if two fast blocks are similar enough to be counted as reps */
function isSimilar(a: SegmentBlock, b: SegmentBlock): boolean {
  const speedRatio = Math.abs(a.avgSpeed - b.avgSpeed) / a.avgSpeed;
  const distRatio = Math.abs(a.totalDistance - b.totalDistance) / a.totalDistance;
  return speedRatio < 0.10 && distRatio < 0.30;
}
