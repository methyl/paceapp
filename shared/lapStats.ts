import type { LapSummary, ActivitySummary } from "./types";
import { speedFromDistanceTime, speedToPace } from "./pace";

/**
 * Anything with a (totalDistance, totalElapsedTime, avgSpeed, avgPace)
 * tuple — laps, segments, splits, the activity summary.
 */
interface PaceShape {
  totalDistance: number;
  totalElapsedTime: number;
  avgSpeed?: number;
  avgPace: string;
}

/**
 * Force avgSpeed and avgPace to be derived from totalDistance /
 * totalElapsedTime. Idempotent.
 *
 * Why this exists: the FIT lap/session's reported `avg_speed` is
 * sometimes systematically faster than `total_distance /
 * total_timer_time` (Apple Watch on paused workouts is the worst
 * offender), and old segment data persisted to R2 was originally
 * computed by averaging instantaneous record speeds. Garmin and the UI
 * consistently display "distance ÷ time", so that's the canonical
 * formula. Running every lap/segment/summary we surface through this
 * helper guarantees MCP, the lap table, and any downstream consumer
 * can never disagree on a pace value.
 */
export function normalizePace<T extends PaceShape>(item: T): T {
  const speed = speedFromDistanceTime(item.totalDistance, item.totalElapsedTime);
  return {
    ...item,
    avgSpeed: speed,
    avgPace: speedToPace(speed),
  };
}

export function normalizeLapsPace<T extends LapSummary>(laps: T[]): T[] {
  return laps.map(normalizePace);
}

export function normalizeSummaryPace(summary: ActivitySummary): ActivitySummary {
  return normalizePace(summary);
}
