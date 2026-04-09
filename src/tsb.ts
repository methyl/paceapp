import type { ParsedActivity } from "./types";
import { getZ2Ceiling } from "./detectWorkout";

/**
 * TSB (Training Stress Balance) model:
 *
 * TRIMP = training impulse per session (HR-based load)
 * CTL = Chronic Training Load (42-day exponential avg of daily TRIMP) = "fitness"
 * ATL = Acute Training Load (7-day exponential avg of daily TRIMP) = "fatigue"
 * TSB = CTL - ATL = "form" (positive = fresh, negative = fatigued)
 */

export interface TSBPoint {
  date: Date;
  dateStr: string;
  trimp: number; // daily TRIMP (0 on rest days)
  ctl: number; // chronic training load
  atl: number; // acute training load
  tsb: number; // training stress balance
}

export interface TSBData {
  points: TSBPoint[];
  currentCTL: number;
  currentATL: number;
  currentTSB: number;
}

const CTL_DAYS = 42;
const ATL_DAYS = 7;

/**
 * Compute TRIMP (Training Impulse) for a workout.
 *
 * Uses per-record HR data when available for accuracy. Falls back
 * to session avg HR. Uses Bannister's exponential TRIMP formula.
 */
function computeTRIMP(activity: ParsedActivity): number {
  const z2 = getZ2Ceiling();
  const restingHR = 50;
  const maxHR = z2 * 1.25;
  const hrReserve = maxHR - restingHR;
  if (hrReserve <= 0) return 0;

  // Use per-record HR for more accurate TRIMP (each record ~1 second)
  if (activity.records.length > 10) {
    let trimp = 0;
    for (const rec of activity.records) {
      if (!rec.heartRate || rec.heartRate < restingHR) continue;
      const deltaHR = Math.min(1, (rec.heartRate - restingHR) / hrReserve);
      // Each record is ~1 second = 1/60 minute
      trimp += (1 / 60) * deltaHR * 0.64 * Math.exp(1.92 * deltaHR);
    }
    return trimp;
  }

  // Fallback: use session average HR
  const avgHR = activity.summary.avgHeartRate;
  if (!avgHR) return 0;

  const duration = activity.summary.totalElapsedTime / 60;
  if (duration <= 0) return 0;

  const deltaHR = Math.max(0, Math.min(1, (avgHR - restingHR) / hrReserve));
  return duration * deltaHR * 0.64 * Math.exp(1.92 * deltaHR);
}

/**
 * Compute TSB model from activities.
 *
 * Builds a daily time series from the first to the last activity date,
 * computing exponential moving averages of daily TRIMP.
 */
export function computeTSB(activities: ParsedActivity[]): TSBData {
  const withDates = activities
    .filter((a) => a.summary.startTime && a.summary.avgHeartRate)
    .map((a) => ({
      date: new Date(a.summary.startTime!),
      trimp: computeTRIMP(a),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (withDates.length === 0) {
    return { points: [], currentCTL: 0, currentATL: 0, currentTSB: 0 };
  }

  // Build daily TRIMP map (sum if multiple workouts on same day)
  const dailyTrimp = new Map<string, number>();
  for (const { date, trimp } of withDates) {
    const key = date.toISOString().slice(0, 10);
    dailyTrimp.set(key, (dailyTrimp.get(key) ?? 0) + trimp);
  }

  // Fill in every day from first to last activity
  const firstDate = withDates[0].date;
  const lastDate = withDates[withDates.length - 1].date;
  const days: { date: Date; dateStr: string; trimp: number }[] = [];

  const current = new Date(firstDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(lastDate);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    const key = current.toISOString().slice(0, 10);
    days.push({
      date: new Date(current),
      dateStr: current.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      trimp: dailyTrimp.get(key) ?? 0,
    });
    current.setDate(current.getDate() + 1);
  }

  // Compute exponential moving averages
  const ctlDecay = 1 - Math.exp(-1 / CTL_DAYS);
  const atlDecay = 1 - Math.exp(-1 / ATL_DAYS);

  let ctl = 0;
  let atl = 0;
  const points: TSBPoint[] = [];

  for (const day of days) {
    ctl = ctl + ctlDecay * (day.trimp - ctl);
    atl = atl + atlDecay * (day.trimp - atl);
    const tsb = Math.round(ctl - atl);

    points.push({
      date: day.date,
      dateStr: day.dateStr,
      trimp: Math.round(day.trimp),
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb,
    });
  }

  const last = points[points.length - 1];

  return {
    points,
    currentCTL: last?.ctl ?? 0,
    currentATL: last?.atl ?? 0,
    currentTSB: last?.tsb ?? 0,
  };
}
