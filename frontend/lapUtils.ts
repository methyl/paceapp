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
 * Work/rest classification for lap rows.
 *
 * Uses the same threshold logic as `labeller.ts` to stay consistent with the
 * workout title: compare each lap's speed against the median × fastMultiplier.
 * Multiplier is strict (1.05) for interval-like types and looser (1.15) for
 * easy/steady.
 *
 * For everything that isn't an interval workout, the work/rest distinction
 * is noise — we return all "working" so callers can hide tags/filters.
 */
export function classifyLaps(
  laps: LapSummary[],
  workoutType?: WorkoutType
): LapKind[] {
  if (laps.length === 0) return [];
  // Only intervals get meaningful work/rest classification. Everything else
  // is a continuous effort; tagging individual laps confuses more than it helps.
  if (workoutType && workoutType !== "intervals") {
    return laps.map(() => "working");
  }

  const paces = laps
    .map((l) => parsePaceToSec(l.avgPace))
    .filter((v): v is number => v != null);
  if (paces.length === 0) return laps.map(() => "working");

  const sorted = [...paces].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // Lower pace = faster. Work threshold = median / 1.05.
  const threshold = median / 1.05;

  return laps.map((l) => {
    const p = parsePaceToSec(l.avgPace);
    return p != null && p < threshold ? "working" : "rest";
  });
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
