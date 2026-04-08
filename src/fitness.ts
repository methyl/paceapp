import type { ParsedActivity, LapSummary, WorkoutType } from "./types";
import { getZ2Ceiling } from "./detectWorkout";

/**
 * Efficiency Factor = (speed m/s) / (heart rate bpm) × 1000
 * Higher = fitter (faster at lower HR).
 */
export function efficiencyFactor(speedMps: number, hr: number): number {
  if (!speedMps || !hr || hr <= 0) return 0;
  return (speedMps / hr) * 1000;
}

// --- Prior load computation (shared with PaceComparison concept) ---

export type LoadCategory = "fresh" | "light" | "moderate" | "heavy";

/**
 * Prior load thresholds using intensity-weighted work.
 * Work = speed * time * intensity_multiplier, where intensity is
 * based on HR relative to Z2. A hard 1km interval at 157bpm counts
 * much more than a slow 1km jog at 120bpm.
 */
export const LOAD_THRESHOLDS = {
  light: 800,
  moderate: 3000,
  heavy: 10000,
};

/**
 * HR intensity multiplier relative to Z2 ceiling.
 *   HR < Z2:       1.0 (baseline)
 *   HR = Z2:       1.0
 *   HR = Z2 + 10%: 1.5
 *   HR = Z2 + 20%: 2.0
 * This means a 1km at 157bpm (Z2=140) gets multiplied by ~1.6x
 */
function hrIntensity(hr: number | undefined, z2: number): number {
  if (hr == null || hr <= z2) return 1.0;
  return 1.0 + ((hr - z2) / z2) * 5;
}

export function computePriorLoad(laps: LapSummary[], upToIndex: number) {
  const z2 = getZ2Ceiling();
  let totalWork = 0;
  let totalTime = 0;
  let totalDist = 0;
  let hrSum = 0;
  let hrTime = 0;

  for (let i = 0; i < upToIndex; i++) {
    const lap = laps[i];
    const speed = lap.avgSpeed ?? 0;
    const time = lap.totalElapsedTime;
    const intensity = hrIntensity(lap.avgHeartRate, z2);
    totalWork += speed * time * intensity;
    totalTime += time;
    totalDist += lap.totalDistance;
    if (lap.avgHeartRate != null) {
      hrSum += lap.avgHeartRate * time;
      hrTime += time;
    }
  }

  const load: LoadCategory =
    totalWork < LOAD_THRESHOLDS.light
      ? "fresh"
      : totalWork < LOAD_THRESHOLDS.moderate
        ? "light"
        : totalWork < LOAD_THRESHOLDS.heavy
          ? "moderate"
          : "heavy";

  return {
    work: totalWork,
    load,
    distance: totalDist / 1000,
    time: totalTime,
    avgHR: hrTime > 0 ? hrSum / hrTime : 0,
    avgSpeed: totalTime > 0 ? totalDist / totalTime : 0,
  };
}

// --- Segment-level EF ---

export interface SegmentEF {
  activityId: string;
  date: Date;
  dateStr: string;
  workoutType: WorkoutType;
  lapIndex: number;
  totalLaps: number;
  ef: number;
  speed: number; // m/s
  hr: number; // bpm
  pace: number; // sec/km
  priorLoad: LoadCategory;
  priorWork: number;
  priorDistance: number;
  priorAvgHR: number;
}

/** Extract per-segment EF with load context from all activities */
export function computeSegmentEFs(activities: ParsedActivity[]): SegmentEF[] {
  const segments: SegmentEF[] = [];

  for (const a of activities) {
    const date = a.summary.startTime ? new Date(a.summary.startTime) : new Date();
    const dateStr = a.summary.startTime
      ? new Date(a.summary.startTime).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : a.fileName;

    const segs = a.segments;
    for (let i = 0; i < segs.length; i++) {
      const lap = segs[i];
      if (!lap.avgSpeed || lap.avgSpeed <= 0 || !lap.avgHeartRate) continue;
      if (lap.totalDistance < 200) continue;

      const prior = computePriorLoad(segs, i);

      segments.push({
        activityId: a.id,
        date,
        dateStr,
        workoutType: a.workoutType,
        lapIndex: i + 1,
        totalLaps: segs.length,
        ef: efficiencyFactor(lap.avgSpeed, lap.avgHeartRate),
        speed: lap.avgSpeed,
        hr: lap.avgHeartRate,
        pace: Math.round(1000 / lap.avgSpeed),
        priorLoad: prior.load,
        priorWork: prior.work,
        priorDistance: +prior.distance.toFixed(1),
        priorAvgHR: Math.round(prior.avgHR),
      });
    }
  }

  return segments.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// --- Activity-level EF (kept for the table / drift chart) ---

export interface ActivityEF {
  id: string;
  date: Date;
  dateStr: string;
  workoutType: WorkoutType;
  ef: number;
  /** Context-normalized: average EF of "fresh" segments only */
  freshEF: number | null;
  /** Average EF of "moderate"/"heavy" segments */
  loadedEF: number | null;
  avgSpeed: number;
  avgHR: number;
  distance: number;
  lapEFs: { lapIndex: number; ef: number; speed: number; hr: number }[];
  driftRatio: number;
}

export function computeActivityEFs(activities: ParsedActivity[]): ActivityEF[] {
  const allSegments = computeSegmentEFs(activities);

  return activities
    .filter((a) => a.summary.avgSpeed && a.summary.avgHeartRate)
    .map((a) => {
      const avgSpeed = a.summary.avgSpeed!;
      const avgHR = a.summary.avgHeartRate!;
      const ef = efficiencyFactor(avgSpeed, avgHR);

      const segs = allSegments.filter((s) => s.activityId === a.id);
      const freshSegs = segs.filter(
        (s) => s.priorLoad === "fresh" || s.priorLoad === "light"
      );
      const loadedSegs = segs.filter(
        (s) => s.priorLoad === "moderate" || s.priorLoad === "heavy"
      );

      const freshEF =
        freshSegs.length > 0
          ? freshSegs.reduce((s, l) => s + l.ef, 0) / freshSegs.length
          : null;
      const loadedEF =
        loadedSegs.length > 0
          ? loadedSegs.reduce((s, l) => s + l.ef, 0) / loadedSegs.length
          : null;

      const lapEFs = a.segments
        .filter((l) => l.avgSpeed && l.avgHeartRate)
        .map((l) => ({
          lapIndex: l.lapIndex,
          ef: efficiencyFactor(l.avgSpeed!, l.avgHeartRate!),
          speed: l.avgSpeed!,
          hr: l.avgHeartRate!,
        }));

      let driftRatio = 1;
      if (lapEFs.length >= 4) {
        const mid = Math.floor(lapEFs.length / 2);
        const firstHalf = lapEFs.slice(0, mid);
        const secondHalf = lapEFs.slice(mid);
        const avgFirst =
          firstHalf.reduce((s, l) => s + l.ef, 0) / firstHalf.length;
        const avgSecond =
          secondHalf.reduce((s, l) => s + l.ef, 0) / secondHalf.length;
        driftRatio = avgFirst > 0 ? avgSecond / avgFirst : 1;
      }

      return {
        id: a.id,
        date: a.summary.startTime ? new Date(a.summary.startTime) : new Date(),
        dateStr: a.summary.startTime
          ? new Date(a.summary.startTime).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : a.fileName,
        workoutType: a.workoutType,
        ef,
        freshEF,
        loadedEF,
        avgSpeed,
        avgHR,
        distance: a.summary.totalDistance / 1000,
        lapEFs,
        driftRatio,
      };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

// --- Fitness snapshots ---

export interface FitnessSnapshot {
  date: Date;
  dateStr: string;
  /** Rolling fresh-segment EF */
  freshEF: number;
  /** Rolling loaded-segment EF */
  loadedEF: number | null;
  /** Rolling whole-activity EF (fallback) */
  rawEF: number;
  score: number;
  sampleSize: number;
}

export interface FitnessSummary {
  activities: ActivityEF[];
  segments: SegmentEF[];
  snapshots: FitnessSnapshot[];
  currentScore: number;
  peakScore: number;
  peakDate: string;
  bestFreshEF: number;
  currentFreshEF: number;
  bestLoadedEF: number;
  currentLoadedEF: number;
  trend: "improving" | "stable" | "declining";
}

function rollingAvg(values: (number | null)[], windowSize: number): (number | null)[] {
  return values.map((_, i) => {
    const window = values
      .slice(Math.max(0, i - windowSize + 1), i + 1)
      .filter((v): v is number => v != null);
    return window.length > 0 ? window.reduce((s, v) => s + v, 0) / window.length : null;
  });
}

/**
 * Compute fitness using context-normalized EF.
 *
 * Primary signal: rolling average of fresh-segment EF across steady runs.
 * Secondary signal: loaded-segment EF for endurance fitness.
 */
export function computeFitness(
  activities: ParsedActivity[],
  windowSize = 5
): FitnessSummary {
  const allEFs = computeActivityEFs(activities);
  const allSegments = computeSegmentEFs(activities);

  // Prefer steady runs for the score, but fall back to all
  const steadyTypes: WorkoutType[] = ["easy", "steady", "tempo"];
  const steadyEFs = allEFs.filter((a) => steadyTypes.includes(a.workoutType));
  const source = steadyEFs.length >= 3 ? steadyEFs : allEFs;

  if (source.length === 0) {
    return {
      activities: allEFs,
      segments: allSegments,
      snapshots: [],
      currentScore: 0,
      peakScore: 0,
      peakDate: "-",
      bestFreshEF: 0,
      currentFreshEF: 0,
      bestLoadedEF: 0,
      currentLoadedEF: 0,
      trend: "stable",
    };
  }

  // Build rolling averages from fresh-segment EF per activity
  const freshEFs = source.map((a) => a.freshEF);
  const loadedEFs = source.map((a) => a.loadedEF);
  const rawEFs = source.map((a) => a.ef);

  const rollingFresh = rollingAvg(freshEFs, windowSize);
  const rollingLoaded = rollingAvg(loadedEFs, windowSize);
  const rollingRaw = rollingAvg(rawEFs, windowSize);

  // Use fresh EF for scoring; fall back to raw if no fresh data
  const scoreBasis = rollingFresh.map((v, i) => v ?? rollingRaw[i] ?? 0);
  const validScores = scoreBasis.filter((v) => v > 0);
  const minEF = validScores.length > 0 ? Math.min(...validScores) : 0;
  const maxEF = validScores.length > 0 ? Math.max(...validScores) : 0;
  const efRange = maxEF - minEF || 1;

  const snapshots: FitnessSnapshot[] = source.map((a, i) => ({
    date: a.date,
    dateStr: a.dateStr,
    freshEF: +(rollingFresh[i] ?? 0).toFixed(2),
    loadedEF: rollingLoaded[i] != null ? +rollingLoaded[i].toFixed(2) : null,
    rawEF: +(rollingRaw[i] ?? 0).toFixed(2),
    score: Math.max(
      0,
      Math.min(100, Math.round(((scoreBasis[i] - minEF) / efRange) * 100))
    ),
    sampleSize: Math.min(i + 1, windowSize),
  }));

  const current = snapshots[snapshots.length - 1];
  const peak = snapshots.reduce((best, s) => (s.score > best.score ? s : best));

  // Trend from fresh EF
  let trend: "improving" | "stable" | "declining" = "stable";
  if (snapshots.length >= 6) {
    const recent = snapshots.slice(-3);
    const prior = snapshots.slice(-6, -3);
    const recentAvg = recent.reduce((s, v) => s + v.freshEF, 0) / 3;
    const priorAvg = prior.reduce((s, v) => s + v.freshEF, 0) / 3;
    if (priorAvg > 0) {
      const change = (recentAvg - priorAvg) / priorAvg;
      if (change > 0.02) trend = "improving";
      else if (change < -0.02) trend = "declining";
    }
  }

  // Best loaded EF
  const loadedValues = allEFs.map((a) => a.loadedEF).filter((v): v is number => v != null);
  const currentLoadedSnap = rollingLoaded.filter((v): v is number => v != null);

  return {
    activities: allEFs,
    segments: allSegments,
    snapshots,
    currentScore: current?.score ?? 0,
    peakScore: peak?.score ?? 0,
    peakDate: peak?.dateStr ?? "-",
    bestFreshEF: maxEF,
    currentFreshEF: current?.freshEF ?? 0,
    bestLoadedEF: loadedValues.length > 0 ? Math.max(...loadedValues) : 0,
    currentLoadedEF: currentLoadedSnap.length > 0
      ? currentLoadedSnap[currentLoadedSnap.length - 1]
      : 0,
    trend,
  };
}
