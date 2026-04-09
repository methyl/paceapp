import type { LapSummary } from "./types";

/**
 * Standard interval distance buckets.
 */
const DISTANCE_BUCKETS = [
  { name: "strides", min: 50, max: 300, canonical: 100 },
  { name: "400m", min: 360, max: 440, canonical: 400 },
  { name: "800m", min: 720, max: 880, canonical: 800 },
  { name: "1km", min: 900, max: 1100, canonical: 1000 },
  { name: "2km", min: 1800, max: 2200, canonical: 2000 },
  { name: "4km", min: 3600, max: 4400, canonical: 4000 },
  { name: "5km", min: 4500, max: 5500, canonical: 5000 },
] as const;

export type DistanceBucket = (typeof DISTANCE_BUCKETS)[number]["name"] | null;

export function getDistanceBucket(distanceMeters: number): DistanceBucket {
  for (const b of DISTANCE_BUCKETS) {
    if (distanceMeters >= b.min && distanceMeters <= b.max) {
      return b.name;
    }
  }
  return null;
}

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

/** Format a duration into a compact label: "30s", "1min", "90s", "2min", "5min" */
function durationLabel(seconds: number): string {
  const rounded = Math.round(seconds / 5) * 5; // round to nearest 5s
  if (rounded < 60) return `${rounded}s`;
  if (rounded % 60 === 0) return `${rounded / 60}min`;
  return `${Math.floor(rounded / 60)}min${rounded % 60}s`;
}

function distLabel(meters: number): string {
  if (meters >= 950) return `${(meters / 1000).toFixed(1).replace(/\.0$/, "")}km`;
  return `${Math.round(meters)}m`;
}

/**
 * Generate a smart training notation label for a workout.
 *
 * Examples:
 *   "10km easy"
 *   "3.5km easy + 6×strides @4:40 + 1.4km easy"
 *   "2km easy + 4×1km @3:50 + 2km easy"
 *   "5km race @4:10"
 */
export function generateWorkoutLabel(
  segments: LapSummary[],
  totalDistance: number,
  workoutType: string
): string {
  if (segments.length === 0) {
    return `${distLabel(totalDistance)} ${workoutType}`;
  }

  // Race/tempo: one block with pace
  if (workoutType === "race" || workoutType === "tempo") {
    const speeds = segments
      .filter((s) => s.avgSpeed && s.avgSpeed > 0 && s.totalDistance > 100)
      .map((s) => s.avgSpeed!);
    if (speeds.length > 0) {
      const avgPace = paceStr(speeds.reduce((a, b) => a + b, 0) / speeds.length);
      return `${distLabel(totalDistance)} ${workoutType} @${avgPace}`;
    }
    return `${distLabel(totalDistance)} ${workoutType}`;
  }

  // Try to find interval/stride structure (works for all types including easy)
  const structured = labelStructuredWorkout(segments, totalDistance, workoutType);
  if (structured) return structured;

  // Fallback: simple label
  return `${distLabel(totalDistance)} ${workoutType}`;
}

/** Returns structured label or null if no interval structure found */
function labelStructuredWorkout(
  segments: LapSummary[],
  totalDistance: number,
  workoutType: string
): string | null {
  const withSpeed = segments.filter(
    (s) => s.avgSpeed && s.avgSpeed > 0 && s.totalDistance > 50
  );
  if (withSpeed.length < 4) return null;

  const speeds = withSpeed.map((s) => s.avgSpeed!);
  const sorted = [...speeds].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // For easy/steady runs, use a higher threshold to only catch
  // genuinely fast segments (strides are 20%+ faster than easy pace).
  // For interval workouts, use a lower threshold.
  const fastMultiplier = workoutType === "easy" || workoutType === "steady" ? 1.15 : 1.05;

  const tagged = withSpeed.map((seg) => {
    const isFast = seg.avgSpeed! > median * fastMultiplier;
    return { seg, isFast };
  });

  const fastSegs = tagged.filter((t) => t.isFast).map((t) => t.seg);

  if (fastSegs.length < 2) return null;

  // Figure out how to label the reps: distance bucket or time
  const repDistances = fastSegs.map((s) => s.totalDistance);
  const avgRepDist = repDistances.reduce((a, b) => a + b, 0) / repDistances.length;
  const repDurations = fastSegs.map((s) => s.totalElapsedTime);
  const avgRepDuration = repDurations.reduce((a, b) => a + b, 0) / repDurations.length;
  const durationCV = repDurations.length > 1
    ? Math.sqrt(repDurations.reduce((s, d) => s + (d - avgRepDuration) ** 2, 0) / repDurations.length) / avgRepDuration
    : 0;

  const repBucket = getDistanceBucket(avgRepDist);

  // Use distance bucket if it matches a standard distance (400m, 800m, 1km, etc.)
  // Otherwise use time label when durations are consistent (strides, custom reps)
  let repDistStr: string;
  if (repBucket && repBucket !== "strides") {
    repDistStr = repBucket;
  } else if (durationCV < 0.20 && avgRepDuration < 300) {
    repDistStr = durationLabel(avgRepDuration);
  } else {
    repDistStr = repBucket ?? distLabel(avgRepDist);
  }

  // Average pace of the fast reps
  const avgRepSpeed = fastSegs.reduce((s, r) => s + r.avgSpeed!, 0) / fastSegs.length;
  const avgRepPace = paceStr(avgRepSpeed);

  // Warmup: slow segments before the first fast segment
  const firstFastIdx = tagged.findIndex((t) => t.isFast);
  const warmupSegs = tagged.slice(0, firstFastIdx).filter((t) => !t.isFast);
  const warmupDist = warmupSegs.reduce((s, t) => s + t.seg.totalDistance, 0);

  // Cooldown: slow segments after the last fast segment
  const lastFastIdx = tagged.length - 1 - [...tagged].reverse().findIndex((t) => t.isFast);
  const cooldownSegs = tagged.slice(lastFastIdx + 1).filter((t) => !t.isFast);
  const cooldownDist = cooldownSegs.reduce((s, t) => s + t.seg.totalDistance, 0);

  // Build label
  const parts: string[] = [];
  if (warmupDist > 200) parts.push(`${distLabel(warmupDist)} easy`);
  parts.push(`${fastSegs.length}×${repDistStr} @${avgRepPace}`);
  if (cooldownDist > 200) parts.push(`${distLabel(cooldownDist)} easy`);

  return parts.join(" + ");
}
