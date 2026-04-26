import type { ParsedActivity, LapSummary, WorkoutType } from "./types";
import { getZ2Ceiling } from "./detectWorkout";
import { getDistanceBucket, type DistanceBucket } from "./labeller";
import { paceSecToStr } from "../shared/pace";

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

export interface FormPoint {
  date: Date;
  dateStr: string;
  score: number;
}

export interface ContextFitness {
  contexts: FitnessContext[];
  /** Composite form over time */
  formCurve: FormPoint[];
  /** Composite score from all contexts, weighted by data quality */
  currentScore: number;
  peakScore: number;
  peakDate: string;
  trend: "improving" | "stable" | "declining";
  /** How each context contributes to the overall score */
  contextWeights: ContextWeight[];
}

function paceBand(secPerKm: number): string {
  // 1-minute bands — wide enough to group meaningful data
  const rounded = Math.floor(secPerKm / 60) * 60;
  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  return `${fmt(rounded)}-${fmt(rounded + 60)}`;
}


const LOAD_LABELS: Record<LoadCategory, string> = {
  fresh: "fresh",
  light: "fresh",
  moderate: "fatigued",
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
  windowDays = 14
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
    // Collapse load into two categories for fewer, more meaningful contexts
    const loadGroup: LoadCategory =
      seg.priorLoad === "fresh" || seg.priorLoad === "light" ? "fresh" : "heavy";
    const key = `${band}|${loadGroup}|${seg.distBucket ?? "other"}`;

    if (!contextMap.has(key)) {
      contextMap.set(key, {
        paceBand: band,
        load: loadGroup,
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

    // Compute rolling EF with time-based window
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const rollingEFs = points.map((p, _i) => {
      const cutoff = p.date.getTime() - windowMs;
      const window = points.filter(
        (q) => q.date.getTime() >= cutoff && q.date.getTime() <= p.date.getTime()
      );
      return window.reduce((s, q) => s + q.ef, 0) / window.length;
    });

    const currentEF = rollingEFs[rollingEFs.length - 1] ?? 0;
    const peakEF = Math.max(...rollingEFs);

    // Label
    const distStr = ctx.distBucket ?? "mixed";
    const avgPace = paceSecToStr(
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
  // Score each context against the global EF range for real variation.

  // Compute global range upfront for the current score too
  const allCtxEFs = contexts
    .filter((c) => c.points.length >= 2)
    .flatMap((c) => c.points.map((p) => p.ef));
  const gMin = allCtxEFs.length > 0 ? Math.min(...allCtxEFs) : 0;
  const gMax = allCtxEFs.length > 0 ? Math.max(...allCtxEFs) : 1;
  const gRange = gMax - gMin || 1;

  const contextWeights: ContextWeight[] = [];
  let totalWeight = 0;

  for (const ctx of contexts) {
    if (ctx.points.length < 2) continue;

    const ctxScore = Math.max(
      0,
      Math.min(100, Math.round(((ctx.currentEF - gMin) / gRange) * 100))
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

  // --- Form curve: composite score at each activity date ---
  // Collect all unique activity dates, then at each date compute
  // the weighted score using each context's rolling EF up to that point.
  const allDates = new Map<number, { date: Date; dateStr: string }>();
  for (const ctx of contexts) {
    for (const p of ctx.points) {
      const ts = p.date.getTime();
      if (!allDates.has(ts)) allDates.set(ts, { date: p.date, dateStr: p.dateStr });
    }
  }

  const sortedDates = [...allDates.values()].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

  const scorableContexts = contexts.filter((c) => c.points.length >= 2);

  // Global EF range across all contexts for a consistent scale.
  // Per-context scoring compressed everything to ~50.
  const allEFValues = scorableContexts.flatMap((c) => c.points.map((p) => p.ef));
  const globalMinEF = allEFValues.length > 0 ? Math.min(...allEFValues) : 0;
  const globalMaxEF = allEFValues.length > 0 ? Math.max(...allEFValues) : 1;
  const globalRange = globalMaxEF - globalMinEF || 1;

  // Max workouts in any 14-day window across the dataset — used to normalize load bonus
  let maxWindowWorkouts = 1;
  for (const { date: d } of sortedDates) {
    const cutoff = d.getTime() - windowDays * 24 * 60 * 60 * 1000;
    const count = new Set(
      scorableContexts.flatMap((c) =>
        c.points
          .filter((p) => p.date.getTime() >= cutoff && p.date.getTime() <= d.getTime())
          .map((p) => p.activityId)
      )
    ).size;
    if (count > maxWindowWorkouts) maxWindowWorkouts = count;
  }

  const formCurve: FormPoint[] = sortedDates.map(({ date, dateStr }) => {
    let weightedScore = 0;
    let usedWeight = 0;
    const ts = date.getTime();
    const cutoff = ts - windowDays * 24 * 60 * 60 * 1000;

    for (const ctx of scorableContexts) {
      const eligible = ctx.points.filter((p) => p.date.getTime() <= ts);
      if (eligible.length < 2) continue;

      const window = eligible.filter((p) => p.date.getTime() >= cutoff);
      if (window.length === 0) continue;

      const rollingEF = window.reduce((s, p) => s + p.ef, 0) / window.length;
      const ctxScore = Math.max(0, Math.min(100, ((rollingEF - globalMinEF) / globalRange) * 100));

      const w = Math.sqrt(window.length);
      weightedScore += ctxScore * w;
      usedWeight += w;
    }

    if (usedWeight === 0) return { date, dateStr, score: 0 };

    const baseScore = weightedScore / usedWeight;

    // Training load bonus: more workouts in the window = higher form.
    // Running 5x/week at EF 22 is better fitness than 1x/2wks at EF 25.
    // Bonus scales 0-20 points based on workouts relative to peak volume.
    const windowWorkouts = new Set(
      scorableContexts.flatMap((c) =>
        c.points
          .filter((p) => p.date.getTime() >= cutoff && p.date.getTime() <= ts)
          .map((p) => p.activityId)
      )
    ).size;
    const loadBonus = (windowWorkouts / maxWindowWorkouts) * 20;

    const score = Math.round(Math.max(0, Math.min(100, baseScore + loadBonus)));
    return { date, dateStr, score };
  }).filter((p) => p.score > 0);

  // Peak from the actual form curve — not a theoretical max
  const peakPoint = formCurve.reduce(
    (best, p) => (p.score > best.score ? p : best),
    formCurve[0] ?? { date: new Date(), dateStr: "-", score: 0 }
  );

  return {
    contexts,
    formCurve,
    currentScore: Math.max(0, Math.min(100, currentScore)),
    peakScore: peakPoint.score,
    peakDate: peakPoint.dateStr,
    trend,
    contextWeights,
  };
}
