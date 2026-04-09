import type { ParsedActivity, LapSummary, WorkoutType } from "./types";
import { getZ2Ceiling } from "./detectWorkout";
import { getDistanceBucket, type DistanceBucket } from "./labeller";

/**
 * Efficiency Factor = (speed m/s) / (heart rate bpm) × 1000
 * Higher = fitter (faster at lower HR).
 */
export function efficiencyFactor(speedMps: number, hr: number): number {
  if (!speedMps || !hr || hr <= 0) return 0;
  return (speedMps / hr) * 1000;
}

// --- Prior load computation ---

export type LoadCategory = "fresh" | "light" | "moderate" | "heavy";

export const LOAD_THRESHOLDS = {
  light: 800,
  moderate: 3000,
  heavy: 10000,
};

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
  speed: number;
  hr: number;
  pace: number;
  distance: number;
  distBucket: DistanceBucket;
  priorLoad: LoadCategory;
  priorWork: number;
  priorDistance: number;
  priorAvgHR: number;
  // Running dynamics
  verticalOscillation?: number;
  groundContactTime?: number;
  strideLength?: number;
  cadence?: number;
  power?: number;
}

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
      if (lap.totalDistance < 50) continue;

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
        distance: lap.totalDistance,
        distBucket: getDistanceBucket(lap.totalDistance),
        priorLoad: prior.load,
        priorWork: prior.work,
        priorDistance: +prior.distance.toFixed(1),
        priorAvgHR: Math.round(prior.avgHR),
        verticalOscillation: lap.avgVerticalOscillation,
        groundContactTime: lap.avgGroundContactTime,
        strideLength: lap.avgStrideLength,
        cadence: lap.avgCadence,
        power: lap.avgPower,
      });
    }
  }

  return segments.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// --- Context-based fitness ---

/**
 * A fitness context groups comparable segments.
 * E.g., "easy 1km fresh" or "800m reps heavy load".
 */
export interface FitnessContext {
  label: string;
  /** What defines this context */
  paceBand: string; // e.g., "5:00-5:30"
  loadCategory: LoadCategory;
  distBucket: DistanceBucket;
  /** One point per workout (averaged if multiple matching segments) */
  points: ContextPoint[];
  /** Current rolling EF */
  currentEF: number;
  /** Best rolling EF */
  peakEF: number;
}

export interface ContextPoint {
  date: Date;
  dateStr: string;
  activityId: string;
  ef: number;
  hr: number;
  speed: number;
  count: number; // how many segments averaged
  verticalOscillation?: number;
  groundContactTime?: number;
  strideLength?: number;
  cadence?: number;
  power?: number;
}

export interface ContextWeight {
  label: string;
  weight: number;
  score: number; // 0-100 for this context
}

export interface ContextFitness {
  contexts: FitnessContext[];
  /** Composite score from all contexts, weighted by data quality */
  currentScore: number;
  peakScore: number;
  peakDate: string;
  trend: "improving" | "stable" | "declining";
  /** How each context contributes to the overall score */
  contextWeights: ContextWeight[];
}

function paceBand(secPerKm: number): string {
  // Round to 30s bands
  const rounded = Math.floor(secPerKm / 30) * 30;
  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  return `${fmt(rounded)}-${fmt(rounded + 30)}`;
}

function paceStr(secPerKm: number): string {
  return `${Math.floor(secPerKm / 60)}:${(Math.round(secPerKm) % 60).toString().padStart(2, "0")}`;
}

const LOAD_LABELS: Record<LoadCategory, string> = {
  fresh: "fresh",
  light: "light",
  moderate: "moderate",
  heavy: "fatigued",
};

/**
 * Build fitness contexts from all segments across all activities.
 *
 * Groups segments by (pace band, load category, distance bucket),
 * then for each context builds a time series of per-workout average EF.
 */
export function computeContextFitness(
  activities: ParsedActivity[],
  windowSize = 4
): ContextFitness {
  const allSegs = computeSegmentEFs(activities);

  // Group segments into contexts
  const contextMap = new Map<
    string,
    {
      paceBand: string;
      load: LoadCategory;
      distBucket: DistanceBucket;
      segments: SegmentEF[];
    }
  >();

  for (const seg of allSegs) {
    const band = paceBand(seg.pace);
    const key = `${band}|${seg.priorLoad}|${seg.distBucket ?? "other"}`;

    if (!contextMap.has(key)) {
      contextMap.set(key, {
        paceBand: band,
        load: seg.priorLoad,
        distBucket: seg.distBucket,
        segments: [],
      });
    }
    contextMap.get(key)!.segments.push(seg);
  }

  // Build contexts — only keep those with >= 2 workouts
  const contexts: FitnessContext[] = [];

  for (const [, ctx] of contextMap) {
    // Group segments by activity, average per workout
    const byActivity = new Map<string, SegmentEF[]>();
    for (const seg of ctx.segments) {
      if (!byActivity.has(seg.activityId)) byActivity.set(seg.activityId, []);
      byActivity.get(seg.activityId)!.push(seg);
    }

    if (byActivity.size < 2) continue;

    const points: ContextPoint[] = [];
    for (const [actId, segs] of byActivity) {
      const avgEF = segs.reduce((s, v) => s + v.ef, 0) / segs.length;
      const avgHR = segs.reduce((s, v) => s + v.hr, 0) / segs.length;
      const avgSpeed = segs.reduce((s, v) => s + v.speed, 0) / segs.length;
      const avgOf = (vals: (number | undefined)[]) => {
        const v = vals.filter((x): x is number => x != null);
        return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
      };

      points.push({
        date: segs[0].date,
        dateStr: segs[0].dateStr,
        activityId: actId,
        ef: +avgEF.toFixed(2),
        hr: Math.round(avgHR),
        speed: avgSpeed,
        count: segs.length,
        verticalOscillation: avgOf(segs.map((s) => s.verticalOscillation)),
        groundContactTime: avgOf(segs.map((s) => s.groundContactTime)),
        strideLength: avgOf(segs.map((s) => s.strideLength)),
        cadence: avgOf(segs.map((s) => s.cadence)),
        power: avgOf(segs.map((s) => s.power)),
      });
    }

    points.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Compute rolling EF
    const rollingEFs = points.map((_, i) => {
      const window = points.slice(Math.max(0, i - windowSize + 1), i + 1);
      return window.reduce((s, p) => s + p.ef, 0) / window.length;
    });

    const currentEF = rollingEFs[rollingEFs.length - 1] ?? 0;
    const peakEF = Math.max(...rollingEFs);

    // Label
    const distStr = ctx.distBucket ?? "mixed";
    const avgPace = paceStr(
      ctx.segments.reduce((s, seg) => s + seg.pace, 0) / ctx.segments.length
    );
    const label = `${distStr} @${avgPace} ${LOAD_LABELS[ctx.load]}`;

    contexts.push({
      label,
      paceBand: ctx.paceBand,
      loadCategory: ctx.load,
      distBucket: ctx.distBucket,
      points,
      currentEF,
      peakEF,
    });
  }

  // Sort: most data points first, then by load (fresh first)
  const loadOrder: Record<LoadCategory, number> = {
    fresh: 0,
    light: 1,
    moderate: 2,
    heavy: 3,
  };
  contexts.sort((a, b) => {
    if (b.points.length !== a.points.length)
      return b.points.length - a.points.length;
    return loadOrder[a.loadCategory] - loadOrder[b.loadCategory];
  });

  // --- Composite score from ALL contexts ---
  // Weight each context by number of data points (more data = more reliable).
  // Score each context 0-100 within its own EF range, then weighted average.

  const contextWeights: ContextWeight[] = [];
  let totalWeight = 0;

  for (const ctx of contexts) {
    if (ctx.points.length < 2) continue;

    const efs = ctx.points.map((p) => p.ef);
    const minEF = Math.min(...efs);
    const maxEF = Math.max(...efs);
    const range = maxEF - minEF || 1;

    const ctxScore = Math.max(
      0,
      Math.min(100, Math.round(((ctx.currentEF - minEF) / range) * 100))
    );

    // Weight by sqrt of data points — diminishing returns for lots of data
    const weight = Math.sqrt(ctx.points.length);
    totalWeight += weight;

    contextWeights.push({
      label: ctx.label,
      weight,
      score: ctxScore,
    });
  }

  // Normalize weights to sum to 1
  if (totalWeight > 0) {
    for (const cw of contextWeights) {
      cw.weight = cw.weight / totalWeight;
    }
  }

  const currentScore =
    contextWeights.length > 0
      ? Math.round(
          contextWeights.reduce((s, cw) => s + cw.score * cw.weight, 0)
        )
      : 0;

  // Peak: best weighted score across all time points
  // For simplicity, use the max per-context peak weighted
  const peakScore =
    contextWeights.length > 0
      ? Math.round(
          contexts
            .filter((c) => c.points.length >= 2)
            .reduce((s, ctx, i) => {
              const efs = ctx.points.map((p) => p.ef);
              const minEF = Math.min(...efs);
              const range = (Math.max(...efs) - minEF) || 1;
              const ctxPeak = Math.round(((ctx.peakEF - minEF) / range) * 100);
              return s + ctxPeak * (contextWeights[i]?.weight ?? 0);
            }, 0)
        )
      : 0;

  // Peak date from the context with the most data
  const bestCtx = contexts.reduce(
    (best, c) => (c.points.length > (best?.points.length ?? 0) ? c : best),
    contexts[0]
  );
  const peakDate = bestCtx
    ? bestCtx.points.reduce((best, p) => (p.ef > best.ef ? p : best)).dateStr
    : "-";

  // Trend: weighted average of per-context trends
  let trendSignal = 0;
  let trendWeight = 0;
  for (const ctx of contexts) {
    if (ctx.points.length < 4) continue;
    const n = ctx.points.length;
    const recentN = Math.min(3, Math.floor(n / 2));
    const recent = ctx.points.slice(-recentN);
    const prior = ctx.points.slice(-recentN * 2, -recentN);
    if (prior.length === 0) continue;
    const recentAvg = recent.reduce((s, p) => s + p.ef, 0) / recent.length;
    const priorAvg = prior.reduce((s, p) => s + p.ef, 0) / prior.length;
    if (priorAvg > 0) {
      const change = (recentAvg - priorAvg) / priorAvg;
      const w = Math.sqrt(ctx.points.length);
      trendSignal += change * w;
      trendWeight += w;
    }
  }

  let trend: "improving" | "stable" | "declining" = "stable";
  if (trendWeight > 0) {
    const avgChange = trendSignal / trendWeight;
    if (avgChange > 0.02) trend = "improving";
    else if (avgChange < -0.02) trend = "declining";
  }

  return {
    contexts,
    currentScore: Math.max(0, Math.min(100, currentScore)),
    peakScore: Math.max(0, Math.min(100, peakScore)),
    peakDate,
    trend,
    contextWeights,
  };
}
