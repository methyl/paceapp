import type { LapSummary } from "./types";

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

// Classify laps as working or rest based on pace relative to the fastest lap.
// Rest laps run ≥15% slower per km than the fastest pace — the rough threshold
// that separates recovery jogs from actual work intervals.
export function classifyLaps(laps: LapSummary[]): LapKind[] {
  if (laps.length === 0) return [];
  const paces = laps
    .map((l) => parsePaceToSec(l.avgPace))
    .filter((v): v is number => v != null);
  if (paces.length === 0) return laps.map(() => "working");
  const fastest = Math.min(...paces);
  const threshold = fastest * 1.15;
  return laps.map((l) => {
    const p = parsePaceToSec(l.avgPace);
    return p != null && p > threshold ? "rest" : "working";
  });
}

// Compute cumulative-distance x-axis bands (0..1) for rest laps.
// Used by TimeSeriesChart to shade rest-zone backgrounds across all panels.
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
