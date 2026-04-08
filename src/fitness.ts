import type { ParsedActivity, WorkoutType } from "./types";

/**
 * Efficiency Factor = (speed m/s) / (heart rate bpm) × 1000
 * Higher = fitter (faster at lower HR).
 * Comparable across workouts of the same type and similar conditions.
 */
export function efficiencyFactor(speedMps: number, hr: number): number {
  if (!speedMps || !hr || hr <= 0) return 0;
  return (speedMps / hr) * 1000;
}

export interface ActivityEF {
  id: string;
  date: Date;
  dateStr: string;
  workoutType: WorkoutType;
  ef: number;
  avgSpeed: number;
  avgHR: number;
  distance: number;
  /** EF from laps — shows per-segment efficiency */
  lapEFs: { lapIndex: number; ef: number; speed: number; hr: number }[];
  /** Cardiac drift: EF of second half vs first half. < 1 means HR drifted up */
  driftRatio: number;
}

export interface FitnessSnapshot {
  date: Date;
  dateStr: string;
  /** Rolling average EF over recent steady runs */
  rollingEF: number;
  /** Fitness score 0-100 relative to personal best EF window */
  score: number;
  /** Number of activities in the rolling window */
  sampleSize: number;
}

export interface FitnessSummary {
  activities: ActivityEF[];
  snapshots: FitnessSnapshot[];
  currentScore: number;
  peakScore: number;
  peakDate: string;
  bestEF: number;
  currentEF: number;
  trend: "improving" | "stable" | "declining";
}

/** Compute EF for each activity */
export function computeActivityEFs(activities: ParsedActivity[]): ActivityEF[] {
  return activities
    .filter((a) => a.summary.avgSpeed && a.summary.avgHeartRate)
    .map((a) => {
      const avgSpeed = a.summary.avgSpeed!;
      const avgHR = a.summary.avgHeartRate!;
      const ef = efficiencyFactor(avgSpeed, avgHR);

      const lapEFs = a.laps
        .filter((l) => l.avgSpeed && l.avgHeartRate)
        .map((l) => ({
          lapIndex: l.lapIndex,
          ef: efficiencyFactor(l.avgSpeed!, l.avgHeartRate!),
          speed: l.avgSpeed!,
          hr: l.avgHeartRate!,
        }));

      // Cardiac drift: compare first-half EF vs second-half EF
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
        avgSpeed: avgSpeed,
        avgHR: avgHR,
        distance: a.summary.totalDistance / 1000,
        lapEFs,
        driftRatio,
      };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Compute fitness snapshots over time.
 *
 * Uses steady-state runs (easy + long) as they're the most reliable
 * for EF comparison. Computes a rolling average over a window.
 */
export function computeFitness(
  activities: ParsedActivity[],
  windowSize = 5
): FitnessSummary {
  const allEFs = computeActivityEFs(activities);

  // Steady runs are most reliable for fitness tracking
  const steadyTypes: WorkoutType[] = ["easy", "long", "tempo"];
  const steadyEFs = allEFs.filter((a) => steadyTypes.includes(a.workoutType));

  // Fall back to all if not enough steady runs
  const source = steadyEFs.length >= 3 ? steadyEFs : allEFs;

  if (source.length === 0) {
    return {
      activities: allEFs,
      snapshots: [],
      currentScore: 0,
      peakScore: 0,
      peakDate: "-",
      bestEF: 0,
      currentEF: 0,
      trend: "stable",
    };
  }

  // Find min/max EF for normalization
  const efValues = source.map((a) => a.ef);
  const minEF = Math.min(...efValues);
  const maxEF = Math.max(...efValues);
  const efRange = maxEF - minEF || 1;

  // Compute rolling average snapshots
  const snapshots: FitnessSnapshot[] = [];
  for (let i = 0; i < source.length; i++) {
    const windowStart = Math.max(0, i - windowSize + 1);
    const window = source.slice(windowStart, i + 1);
    const rollingEF =
      window.reduce((s, a) => s + a.ef, 0) / window.length;
    const score = Math.round(((rollingEF - minEF) / efRange) * 100);

    snapshots.push({
      date: source[i].date,
      dateStr: source[i].dateStr,
      rollingEF: +rollingEF.toFixed(2),
      score: Math.max(0, Math.min(100, score)),
      sampleSize: window.length,
    });
  }

  const currentSnapshot = snapshots[snapshots.length - 1];
  const peakSnapshot = snapshots.reduce((best, s) =>
    s.score > best.score ? s : best
  );

  // Trend: compare last 3 vs previous 3
  let trend: "improving" | "stable" | "declining" = "stable";
  if (snapshots.length >= 6) {
    const recent = snapshots.slice(-3);
    const prior = snapshots.slice(-6, -3);
    const recentAvg = recent.reduce((s, v) => s + v.rollingEF, 0) / 3;
    const priorAvg = prior.reduce((s, v) => s + v.rollingEF, 0) / 3;
    const change = (recentAvg - priorAvg) / priorAvg;
    if (change > 0.02) trend = "improving";
    else if (change < -0.02) trend = "declining";
  }

  return {
    activities: allEFs,
    snapshots,
    currentScore: currentSnapshot?.score ?? 0,
    peakScore: peakSnapshot?.score ?? 0,
    peakDate: peakSnapshot?.dateStr ?? "-",
    bestEF: maxEF,
    currentEF: currentSnapshot?.rollingEF ?? 0,
    trend,
  };
}
