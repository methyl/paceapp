import type { LapSummary, WorkoutType } from "./types";

export type LapKind = "working" | "rest";
export type LapFilter = "all" | "working";

export function parsePaceToSec(pace: string | number | undefined | null): number | null {
  if (pace == null) return null;
  if (typeof pace === "number") return pace;
  const m = pace.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function paceSecToStr(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Mark each lap "working" if its speed exceeds median × multiplier.
 *
 * Shared between `classifyLaps` (UI tags) and `labeller.labelStructuredWorkout`
 * (title rep count) so the "N×" in the title always matches the work-tag count.
 * Speed-based (not pace-based) to avoid precision loss from rounded M:SS strings.
 */
export function classifyBySpeed(
  laps: LapSummary[],
  multiplier: number
): LapKind[] {
  if (laps.length === 0) return [];
  const speeds = laps
    .map((l) => l.avgSpeed)
    .filter((s): s is number => typeof s === "number" && s > 0);
  if (speeds.length === 0) return laps.map(() => "working");

  const sorted = [...speeds].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = median * multiplier;

  return laps.map((l) =>
    l.avgSpeed != null && l.avgSpeed > threshold ? "working" : "rest"
  );
}

/**
 * Work/rest classification for lap rows.
 *
 * For everything that isn't an interval workout, the work/rest distinction
 * is noise — we return all "working" so callers can hide tags/filters.
 */
export function classifyLaps(
  laps: LapSummary[],
  workoutType?: WorkoutType
): LapKind[] {
  if (laps.length === 0) return [];
  if (workoutType && workoutType !== "intervals") {
    return laps.map(() => "working");
  }
  return classifyBySpeed(laps, 1.05);
}

// Compute cumulative-distance x-axis bands (0..1) for rest laps.
export function restBands(
  laps: LapSummary[],
  kinds: LapKind[]
): Array<[number, number]> {
  const total = laps.reduce((a, l) => a + l.totalDistance, 0);
  if (total <= 0) return [];
  let cursor = 0;
  const bands: Array<[number, number]> = [];
  laps.forEach((l, i) => {
    const start = cursor / total;
    cursor += l.totalDistance;
    const end = cursor / total;
    if (kinds[i] === "rest") bands.push([start, end]);
  });
  return bands;
}
