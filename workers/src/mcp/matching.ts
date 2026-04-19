// Self-contained similar-intervals matching, duplicated from
// frontend/segmentHistory.ts so the MCP server doesn't pull in DOM-only
// modules (localStorage etc.). Keep in sync manually — we can factor into
// a shared package if this grows.

interface Seg {
  avgSpeed?: number | null;
  avgHeartRate?: number | null;
  totalDistance: number;
}

interface ActivitySegs {
  id: string;
  fileName: string;
  startTime: string | null;
  segments: Seg[];
}

export type LoadCategory = "fresh" | "light" | "moderate" | "heavy";

const LOAD_THRESHOLDS = { light: 800, moderate: 3000, heavy: 10000 };

const ADJACENT_LOADS: Record<LoadCategory, LoadCategory[]> = {
  fresh: ["fresh", "light"],
  light: ["fresh", "light", "moderate"],
  moderate: ["light", "moderate", "heavy"],
  heavy: ["moderate", "heavy"],
};

const DISTANCE_BUCKETS = [
  { name: "strides", min: 50, max: 300 },
  { name: "400m", min: 360, max: 440 },
  { name: "800m", min: 720, max: 880 },
  { name: "1km", min: 900, max: 1100 },
  { name: "2km", min: 1800, max: 2200 },
  { name: "4km", min: 3600, max: 4400 },
  { name: "5km", min: 4500, max: 5500 },
] as const;

type DistanceBucket = (typeof DISTANCE_BUCKETS)[number]["name"] | null;

function distanceBucket(m: number): DistanceBucket {
  for (const b of DISTANCE_BUCKETS) {
    if (m >= b.min && m <= b.max) return b.name;
  }
  return null;
}

function efficiency(speedMps: number, hr: number): number {
  if (!speedMps || !hr || hr <= 0) return 0;
  return (speedMps / hr) * 1000;
}

function hrIntensity(hr: number | undefined | null, z2: number): number {
  if (hr == null || hr <= z2) return 1.0;
  return 1.0 + ((hr - z2) / z2) * 5;
}

function priorLoad(segs: Seg[], upTo: number, z2: number): LoadCategory {
  let cumulative = 0;
  for (let i = 0; i < upTo; i++) {
    const s = segs[i];
    if (!s) continue;
    const intensity = hrIntensity(s.avgHeartRate ?? undefined, z2);
    cumulative += s.totalDistance * intensity;
  }
  if (cumulative < LOAD_THRESHOLDS.light) return "fresh";
  if (cumulative < LOAD_THRESHOLDS.moderate) return "light";
  if (cumulative < LOAD_THRESHOLDS.heavy) return "moderate";
  return "heavy";
}

export interface Reference {
  pace_s_per_km: number;
  load: LoadCategory;
  distance_bucket: DistanceBucket;
  tolerance_s?: number;
}

export interface MatchPoint {
  activity_id: string;
  file_name: string;
  date: string | null;
  segment_count: number;
  avg_ef: number;
  avg_hr: number;
}

/**
 * Match segments across activities against a reference interval.
 * Returns one aggregate row per activity that has at least one matching
 * segment. Ordered oldest → newest.
 */
export function findMatches(
  activities: ActivitySegs[],
  ref: Reference,
  z2 = 140,
): MatchPoint[] {
  const targetPace = ref.pace_s_per_km;
  const tolerance = ref.tolerance_s ?? 15;
  const allowedLoads = ADJACENT_LOADS[ref.load];

  const out: MatchPoint[] = [];
  for (const a of activities) {
    const segs = a.segments;
    const efs: number[] = [];
    const hrs: number[] = [];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!seg.avgSpeed || seg.avgSpeed <= 0 || !seg.avgHeartRate) continue;
      if (seg.totalDistance < 50) continue;

      const segPace = 1000 / seg.avgSpeed;
      if (Math.abs(segPace - targetPace) > tolerance) continue;

      const load = priorLoad(segs, i, z2);
      if (!allowedLoads.includes(load)) continue;

      const segBucket = distanceBucket(seg.totalDistance);
      if (ref.distance_bucket !== segBucket) continue;

      efs.push(efficiency(seg.avgSpeed, seg.avgHeartRate));
      hrs.push(seg.avgHeartRate);
    }
    if (efs.length === 0) continue;
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    out.push({
      activity_id: a.id,
      file_name: a.fileName,
      date: a.startTime,
      segment_count: efs.length,
      avg_ef: +avg(efs).toFixed(2),
      avg_hr: Math.round(avg(hrs)),
    });
  }
  out.sort((x, y) => (x.date ?? "").localeCompare(y.date ?? ""));
  return out;
}
