import type { LapSummary, RecordPoint } from "./types";
import { classifyBySpeed } from "./lapUtils";
import { speedToPace } from "./pace";

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
 * Extracted structured-rep detection, shared between the label generator
 * and the server-side tag deriver. Returns the detected fast reps plus
 * the canonical warmup/cooldown distances and average rep stats. Null
 * when no clear structure is present.
 */
export interface RepStructure {
  fastSegs: LapSummary[];
  warmupDist: number;
  cooldownDist: number;
  avgRepDistance: number;
  avgRepDuration: number;
  repBucket: DistanceBucket;
  isHills: boolean;
}

export function detectRepStructure(
  segments: LapSummary[],
  workoutType: string,
  records: RecordPoint[] = [],
): RepStructure | null {
  const withSpeed = segments.filter(
    (s) => s.avgSpeed && s.avgSpeed > 0 && s.totalDistance > 50
  );
  if (withSpeed.length < 4) return null;

  const fastMultiplier = workoutType === "easy" || workoutType === "steady" ? 1.15 : 1.05;
  const kinds = classifyBySpeed(withSpeed, fastMultiplier);

  const tagged = withSpeed.map((seg, i) => ({ seg, isFast: kinds[i] === "working" }));
  const fastSegs = tagged.filter((t) => t.isFast).map((t) => t.seg);
  if (fastSegs.length < 2) return null;

  const repDistances = fastSegs.map((s) => s.totalDistance);
  const avgRepDistance = repDistances.reduce((a, b) => a + b, 0) / repDistances.length;
  const repDurations = fastSegs.map((s) => s.totalElapsedTime);
  const avgRepDuration = repDurations.reduce((a, b) => a + b, 0) / repDurations.length;

  const firstFastIdx = tagged.findIndex((t) => t.isFast);
  const warmupDist = tagged
    .slice(0, firstFastIdx)
    .filter((t) => !t.isFast)
    .reduce((s, t) => s + t.seg.totalDistance, 0);

  const lastFastIdx = tagged.length - 1 - [...tagged].reverse().findIndex((t) => t.isFast);
  const cooldownDist = tagged
    .slice(lastFastIdx + 1)
    .filter((t) => !t.isFast)
    .reduce((s, t) => s + t.seg.totalDistance, 0);

  return {
    fastSegs,
    warmupDist,
    cooldownDist,
    avgRepDistance,
    avgRepDuration,
    repBucket: getDistanceBucket(avgRepDistance),
    isHills: areRepsUphill(fastSegs, records),
  };
}

/**
 * Check if fast reps are uphill by looking at altitude gain during each rep.
 * Returns true if most reps gain significant elevation (>2m).
 */
export function areRepsUphill(fastSegs: LapSummary[], records: RecordPoint[]): boolean {
  if (records.length < 10) return false;

  let uphillCount = 0;

  for (const seg of fastSegs) {
    const segStart = new Date(seg.startTime).getTime();
    const segEnd = segStart + seg.totalElapsedTime * 1000;

    const segRecords = records.filter((r) => {
      const t = new Date(r.timestamp).getTime();
      return t >= segStart && t <= segEnd && r.altitude != null;
    });

    if (segRecords.length < 3) continue;

    const startAlt = segRecords[0].altitude!;
    const endAlt = segRecords[segRecords.length - 1].altitude!;
    const gain = endAlt - startAlt;

    if (gain > 2) uphillCount++;
  }

  return fastSegs.length >= 2 && uphillCount / fastSegs.length > 0.6;
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
  workoutType: string,
  records: RecordPoint[] = []
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
      const avgPace = speedToPace(speeds.reduce((a, b) => a + b, 0) / speeds.length);
      return `${distLabel(totalDistance)} ${workoutType} @${avgPace}`;
    }
    return `${distLabel(totalDistance)} ${workoutType}`;
  }

  const rep = detectRepStructure(segments, workoutType, records);
  if (!rep) {
    return `${distLabel(totalDistance)} ${workoutType}`;
  }

  const avgRepDuration = rep.avgRepDuration;
  const repDurations = rep.fastSegs.map((s) => s.totalElapsedTime);
  const durationCV = repDurations.length > 1
    ? Math.sqrt(repDurations.reduce((s, d) => s + (d - avgRepDuration) ** 2, 0) / repDurations.length) / avgRepDuration
    : 0;

  let repDistStr: string;
  if (rep.repBucket && rep.repBucket !== "strides") {
    repDistStr = rep.repBucket;
  } else if (durationCV < 0.20 && avgRepDuration < 300) {
    repDistStr = durationLabel(avgRepDuration);
  } else {
    repDistStr = rep.repBucket ?? distLabel(rep.avgRepDistance);
  }

  if (rep.isHills) {
    if (rep.repBucket === "strides" || (durationCV < 0.20 && avgRepDuration < 300)) {
      repDistStr = durationLabel(avgRepDuration) + " hills";
    } else {
      repDistStr = (rep.repBucket ?? distLabel(rep.avgRepDistance)) + " hills";
    }
  }

  const avgRepSpeed = rep.fastSegs.reduce((s, r) => s + r.avgSpeed!, 0) / rep.fastSegs.length;
  const avgRepPace = speedToPace(avgRepSpeed);

  // Warmup/cooldown adopt the same word as the overall workoutType so
  // the label reads coherently with the pill. A user whose zones
  // classify a 12km easy-paced run as "steady" sees "12km steady +
  // N×... + 1km steady" rather than a label that contradicts the pill.
  const paceWord = workoutType === "steady" || workoutType === "tempo" ? workoutType : "easy";

  const parts: string[] = [];
  if (rep.warmupDist > 200) parts.push(`${distLabel(rep.warmupDist)} ${paceWord}`);
  parts.push(`${rep.fastSegs.length}×${repDistStr} @${avgRepPace}`);
  if (rep.cooldownDist > 200) parts.push(`${distLabel(rep.cooldownDist)} ${paceWord}`);

  return parts.join(" + ");
}
