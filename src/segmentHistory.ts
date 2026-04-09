import type { ParsedActivity, LapSummary } from "./types";
import { efficiencyFactor, computePriorLoad } from "./fitness";
import type { LoadCategory } from "./fitness";
import { getDistanceBucket, type DistanceBucket } from "./labeller";

const ADJACENT_LOADS: Record<LoadCategory, LoadCategory[]> = {
  fresh: ["fresh", "light"],
  light: ["fresh", "light", "moderate"],
  moderate: ["light", "moderate", "heavy"],
  heavy: ["moderate", "heavy"],
};

export interface SegmentGroup {
  avgSpeed: number;
  avgPace: string;
  load: LoadCategory;
  distBucket: DistanceBucket;
  segments: { seg: LapSummary; index: number }[];
  avgEF: number;
  avgHR: number;
  avgVerticalOscillation?: number;
  avgGroundContactTime?: number;
  avgStrideLength?: number;
  avgVerticalRatio?: number;
  avgCadence?: number;
  avgPower?: number;
}

export interface WorkoutPoint {
  date: Date;
  dateStr: string;
  avgEF: number;
  avgHR: number;
  avgPace: string;
  count: number;
  isCurrent: boolean;
  avgVerticalOscillation?: number;
  avgGroundContactTime?: number;
  avgStrideLength?: number;
  avgVerticalRatio?: number;
  avgCadence?: number;
  avgPower?: number;
}

function paceStr(speedMps: number): string {
  if (!speedMps || speedMps <= 0) return "-";
  const s = 1000 / speedMps;
  return `${Math.floor(s / 60)}:${Math.round(s % 60).toString().padStart(2, "0")}`;
}

function avgOf(vals: (number | undefined)[]): number | undefined {
  const valid = vals.filter((v): v is number => v != null);
  return valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : undefined;
}

/**
 * Group the current workout's segments by similar pace, load, and distance bucket.
 * Each group includes averaged running dynamics.
 */
export function groupCurrentSegments(activity: ParsedActivity): SegmentGroup[] {
  const groups: SegmentGroup[] = [];

  for (let i = 0; i < activity.segments.length; i++) {
    const seg = activity.segments[i];
    if (!seg.avgSpeed || seg.avgSpeed <= 0 || !seg.avgHeartRate) continue;
    if (seg.totalDistance < 50) continue;

    const pace = 1000 / seg.avgSpeed;
    const load = computePriorLoad(activity.segments, i).load;
    const distBucket = getDistanceBucket(seg.totalDistance);

    const existing = groups.find((g) => {
      const gPace = 1000 / g.avgSpeed;
      return Math.abs(pace - gPace) <= 15 && g.load === load && g.distBucket === distBucket;
    });

    if (existing) {
      existing.segments.push({ seg, index: i });
      updateGroupAverages(existing);
    } else {
      groups.push({
        avgSpeed: seg.avgSpeed,
        avgPace: paceStr(seg.avgSpeed),
        load,
        distBucket,
        segments: [{ seg, index: i }],
        avgEF: efficiencyFactor(seg.avgSpeed, seg.avgHeartRate),
        avgHR: seg.avgHeartRate,
        avgVerticalOscillation: seg.avgVerticalOscillation,
        avgGroundContactTime: seg.avgGroundContactTime,
        avgStrideLength: seg.avgStrideLength,
        avgVerticalRatio: seg.avgVerticalRatio,
        avgCadence: seg.avgCadence,
        avgPower: seg.avgPower,
      });
    }
  }

  return groups;
}

function updateGroupAverages(group: SegmentGroup) {
  const segs = group.segments.map((s) => s.seg);
  const n = segs.length;
  group.avgSpeed = segs.reduce((s, v) => s + (v.avgSpeed ?? 0), 0) / n;
  group.avgPace = paceStr(group.avgSpeed);
  group.avgEF = segs.reduce((s, v) => s + efficiencyFactor(v.avgSpeed!, v.avgHeartRate!), 0) / n;
  group.avgHR = segs.reduce((s, v) => s + (v.avgHeartRate ?? 0), 0) / n;
  group.avgVerticalOscillation = avgOf(segs.map((s) => s.avgVerticalOscillation));
  group.avgGroundContactTime = avgOf(segs.map((s) => s.avgGroundContactTime));
  group.avgStrideLength = avgOf(segs.map((s) => s.avgStrideLength));
  group.avgVerticalRatio = avgOf(segs.map((s) => s.avgVerticalRatio));
  group.avgCadence = avgOf(segs.map((s) => s.avgCadence));
  group.avgPower = avgOf(segs.map((s) => s.avgPower));
}

/**
 * Find matching segments from all workouts, averaged per workout.
 * Returns one point per workout with EF and running dynamics.
 */
export function findHistoricalPoints(
  group: SegmentGroup,
  allActivities: ParsedActivity[],
  currentId: string
): WorkoutPoint[] {
  const targetPace = 1000 / group.avgSpeed;
  const TOLERANCE = 15;
  const allowedLoads = ADJACENT_LOADS[group.load];

  interface WorkoutAccum {
    efs: number[];
    hrs: number[];
    vos: number[];
    gcts: number[];
    sls: number[];
    vrs: number[];
    cads: number[];
    pows: number[];
    date: Date;
    dateStr: string;
  }

  const workoutMap = new Map<string, WorkoutAccum>();

  for (const a of allActivities) {
    const segs = a.segments;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!seg.avgSpeed || seg.avgSpeed <= 0 || !seg.avgHeartRate) continue;
      if (seg.totalDistance < 50) continue;

      const segPace = 1000 / seg.avgSpeed;
      if (Math.abs(segPace - targetPace) > TOLERANCE) continue;

      const load = computePriorLoad(segs, i).load;
      if (!allowedLoads.includes(load)) continue;

      const segBucket = getDistanceBucket(seg.totalDistance);
      if (group.distBucket !== segBucket) continue;

      if (!workoutMap.has(a.id)) {
        workoutMap.set(a.id, {
          efs: [], hrs: [], vos: [], gcts: [], sls: [], vrs: [], cads: [], pows: [],
          date: a.summary.startTime ? new Date(a.summary.startTime) : new Date(),
          dateStr: a.summary.startTime
            ? new Date(a.summary.startTime).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : a.fileName,
        });
      }

      const e = workoutMap.get(a.id)!;
      e.efs.push(efficiencyFactor(seg.avgSpeed, seg.avgHeartRate));
      e.hrs.push(seg.avgHeartRate);
      if (seg.avgVerticalOscillation != null) e.vos.push(seg.avgVerticalOscillation);
      if (seg.avgGroundContactTime != null) e.gcts.push(seg.avgGroundContactTime);
      if (seg.avgStrideLength != null) e.sls.push(seg.avgStrideLength);
      if (seg.avgVerticalRatio != null) e.vrs.push(seg.avgVerticalRatio);
      if (seg.avgCadence != null) e.cads.push(seg.avgCadence);
      if (seg.avgPower != null) e.pows.push(seg.avgPower);
    }
  }

  const points: WorkoutPoint[] = [];
  for (const [id, e] of workoutMap) {
    if (e.efs.length === 0) continue;
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : undefined;
    points.push({
      date: e.date,
      dateStr: e.dateStr,
      avgEF: +((avg(e.efs) ?? 0).toFixed(2)),
      avgHR: Math.round(avg(e.hrs) ?? 0),
      avgPace: paceStr(group.avgSpeed),
      count: e.efs.length,
      isCurrent: id === currentId,
      avgVerticalOscillation: avg(e.vos),
      avgGroundContactTime: avg(e.gcts),
      avgStrideLength: avg(e.sls),
      avgVerticalRatio: avg(e.vrs),
      avgCadence: avg(e.cads),
      avgPower: avg(e.pows),
    });
  }

  return points.sort((a, b) => a.date.getTime() - b.date.getTime());
}
