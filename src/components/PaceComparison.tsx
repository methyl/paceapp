import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ComposedChart,
  Bar,
  Cell,
} from "recharts";
import type { ParsedActivity, LapSummary } from "../types";
import { WORKOUT_LABELS, WORKOUT_COLORS } from "../types";

interface PaceComparisonProps {
  activities: ParsedActivity[];
}

interface MatchedSegment {
  activityId: string;
  date: string;
  fileName: string;
  workoutType: string;
  workoutLabel: string;
  workoutColor: string;
  lapIndex: number;
  totalLaps: number;
  /** position in workout: 0 = start, 1 = end */
  relativePosition: number;
  positionLabel: string;
  pace: number; // sec/km
  paceLabel: string;
  hr: number;
  /** prior load: cumulative (speed * duration) of preceding laps, normalized */
  priorLoad: number;
  priorLoadLabel: string;
  priorDistance: number; // km done before this lap
  priorAvgSpeed: number; // avg speed of prior laps (m/s)
  priorAvgHR: number;
}

function paceToStr(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function computePriorLoad(laps: LapSummary[], upToIndex: number): {
  load: number;
  distance: number;
  avgSpeed: number;
  avgHR: number;
} {
  const prior = laps.slice(0, upToIndex);
  if (prior.length === 0) {
    return { load: 0, distance: 0, avgSpeed: 0, avgHR: 0 };
  }

  let totalWork = 0;
  let totalTime = 0;
  let totalDist = 0;
  let hrSum = 0;
  let hrCount = 0;

  for (const lap of prior) {
    const speed = lap.avgSpeed ?? 0;
    const time = lap.totalElapsedTime;
    // Work = speed * time (approximation of training load for that segment)
    totalWork += speed * time;
    totalTime += time;
    totalDist += lap.totalDistance;
    if (lap.avgHeartRate != null) {
      hrSum += lap.avgHeartRate * time;
      hrCount += time;
    }
  }

  return {
    load: totalWork,
    distance: totalDist / 1000,
    avgSpeed: totalTime > 0 ? totalDist / totalTime : 0,
    avgHR: hrCount > 0 ? hrSum / hrCount : 0,
  };
}

function findMatchingSegments(
  activities: ParsedActivity[],
  targetPace: number,
  tolerance: number
): MatchedSegment[] {
  const segments: MatchedSegment[] = [];
  const minPace = targetPace - tolerance;
  const maxPace = targetPace + tolerance;

  for (const a of activities) {
    for (let i = 0; i < a.segments.length; i++) {
      const lap = a.segments[i];
      if (!lap.avgSpeed || lap.avgSpeed <= 0 || lap.avgHeartRate == null) continue;
      if (lap.totalDistance < 200) continue; // skip tiny segments

      const secPerKm = 1000 / lap.avgSpeed;
      if (secPerKm < minPace || secPerKm > maxPace) continue;

      const prior = computePriorLoad(a.segments, i);
      const relPos = a.segments.length > 1 ? i / (a.segments.length - 1) : 0;

      let positionLabel: string;
      if (relPos < 0.2) positionLabel = "Start";
      else if (relPos < 0.45) positionLabel = "Early";
      else if (relPos < 0.65) positionLabel = "Middle";
      else if (relPos < 0.85) positionLabel = "Late";
      else positionLabel = "End";

      segments.push({
        activityId: a.id,
        date: a.summary.startTime
          ? new Date(a.summary.startTime).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : a.fileName,
        fileName: a.fileName,
        workoutType: a.workoutType,
        workoutLabel: WORKOUT_LABELS[a.workoutType],
        workoutColor: WORKOUT_COLORS[a.workoutType],
        lapIndex: i + 1,
        totalLaps: a.segments.length,
        relativePosition: relPos,
        positionLabel,
        pace: Math.round(secPerKm),
        paceLabel: paceToStr(secPerKm),
        hr: Math.round(lap.avgHeartRate),
        priorLoad: prior.load,
        priorLoadLabel: prior.load < 1000
          ? "Fresh"
          : prior.load < 5000
            ? "Light"
            : prior.load < 15000
              ? "Moderate"
              : "Heavy",
        priorDistance: +prior.distance.toFixed(1),
        priorAvgSpeed: prior.avgSpeed,
        priorAvgHR: Math.round(prior.avgHR),
      });
    }
  }

  return segments.sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    return db - da;
  });
}

/** Guess common paces across all activities for quick-select */
function suggestPaces(activities: ParsedActivity[]): number[] {
  const paces: number[] = [];
  for (const a of activities) {
    for (const lap of a.segments) {
      if (lap.avgSpeed && lap.avgSpeed > 0 && lap.totalDistance > 200) {
        paces.push(Math.round(1000 / lap.avgSpeed));
      }
    }
  }
  if (paces.length === 0) return [300, 330, 360];

  const min = Math.min(...paces);
  const max = Math.max(...paces);
  // Generate buckets at 15s intervals
  const buckets: number[] = [];
  for (let p = Math.floor(min / 15) * 15; p <= Math.ceil(max / 15) * 15; p += 15) {
    if (p >= 150 && p <= 600) buckets.push(p);
  }
  return buckets;
}

const LOAD_COLORS: Record<string, string> = {
  Fresh: "#22c55e",
  Light: "#84cc16",
  Moderate: "#f59e0b",
  Heavy: "#ef4444",
};

export default function PaceComparison({ activities }: PaceComparisonProps) {
  const suggestedPaces = useMemo(() => suggestPaces(activities), [activities]);
  const defaultPace = suggestedPaces[Math.floor(suggestedPaces.length / 2)] ?? 330;

  const [targetPace, setTargetPace] = useState(defaultPace);
  const [tolerance, setTolerance] = useState(10);

  const segments = useMemo(
    () => findMatchingSegments(activities, targetPace, tolerance),
    [activities, targetPace, tolerance]
  );

  // Group by prior load category for the bar chart
  const hrByLoad = useMemo(() => {
    const groups: Record<string, number[]> = {};
    for (const s of segments) {
      if (!groups[s.priorLoadLabel]) groups[s.priorLoadLabel] = [];
      groups[s.priorLoadLabel].push(s.hr);
    }
    return ["Fresh", "Light", "Moderate", "Heavy"]
      .filter((k) => groups[k]?.length)
      .map((label) => ({
        label,
        avgHR: Math.round(
          groups[label].reduce((s, v) => s + v, 0) / groups[label].length
        ),
        count: groups[label].length,
      }));
  }, [segments]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          Pace Segment Comparison
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          Select a target pace to find all matching segments across workouts.
          Segments are grouped by prior workload — how hard the preceding laps were.
        </p>
      </div>

      {/* Pace selector */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Target Pace
            </label>
            <div className="text-3xl font-bold text-gray-900">
              {paceToStr(targetPace)}
              <span className="text-sm font-normal text-gray-500 ml-1">/km</span>
            </div>
            <input
              type="range"
              min={suggestedPaces[0] ?? 180}
              max={suggestedPaces[suggestedPaces.length - 1] ?? 480}
              step={5}
              value={targetPace}
              onChange={(e) => setTargetPace(Number(e.target.value))}
              className="w-64 mt-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Tolerance
            </label>
            <select
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            >
              <option value={5}>&plusmn;5s/km</option>
              <option value={10}>&plusmn;10s/km</option>
              <option value={15}>&plusmn;15s/km</option>
              <option value={20}>&plusmn;20s/km</option>
              <option value={30}>&plusmn;30s/km</option>
            </select>
          </div>
          <div className="text-sm text-gray-500">
            {segments.length} matching segment{segments.length !== 1 ? "s" : ""}
            <span className="text-xs ml-1">
              ({paceToStr(targetPace - tolerance)} – {paceToStr(targetPace + tolerance)} /km)
            </span>
          </div>
        </div>

        {/* Quick pace buttons */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {suggestedPaces
            .filter((_, i) => i % 2 === 0 || suggestedPaces.length < 12)
            .map((p) => (
              <button
                key={p}
                onClick={() => setTargetPace(p)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  Math.abs(targetPace - p) < 8
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {paceToStr(p)}
              </button>
            ))}
        </div>
      </div>

      {segments.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          No matching segments found. Try adjusting the pace or tolerance.
        </div>
      )}

      {segments.length > 0 && (
        <>
          {/* HR by prior load bar chart */}
          {hrByLoad.length > 1 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">
                Avg HR by Prior Workload at ~{paceToStr(targetPace)}/km
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                Shows how much harder the same pace feels after prior effort.
                "Fresh" = start of workout, "Heavy" = after significant prior load.
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={hrByLoad}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    domain={["auto", "auto"]}
                    label={{
                      value: "Avg HR (bpm)",
                      angle: -90,
                      position: "insideLeft",
                      fontSize: 11,
                    }}
                  />
                  <Tooltip
                    content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0]?.payload as (typeof hrByLoad)[0];
                      return (
                        <div className="bg-white border border-gray-200 rounded p-2 text-xs shadow">
                          <div className="font-semibold">{d.label} prior load</div>
                          <div>Avg HR: {d.avgHR} bpm</div>
                          <div>{d.count} segments</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="avgHR" radius={[4, 4, 0, 0]}>
                    {hrByLoad.map((d, i) => (
                      <Cell
                        key={i}
                        fill={LOAD_COLORS[d.label] ?? "#6b7280"}
                        opacity={0.85}
                      />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Scatter: HR vs prior distance, colored by workout type */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">
              HR vs Prior Distance at ~{paceToStr(targetPace)}/km
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Each dot is one segment. X = how far into the workout. Y = heart rate.
              Color = workout type. Dots higher & to the right = more fatigued.
            </p>
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart margin={{ top: 5, right: 20, bottom: 20, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="priorDistance"
                  type="number"
                  tick={{ fontSize: 11 }}
                  domain={[0, "auto"]}
                  label={{
                    value: "Prior distance (km)",
                    position: "insideBottom",
                    offset: -10,
                    fontSize: 11,
                  }}
                />
                <YAxis
                  dataKey="hr"
                  type="number"
                  tick={{ fontSize: 11 }}
                  domain={["auto", "auto"]}
                  label={{
                    value: "HR (bpm)",
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 11,
                  }}
                />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const d = payload[0]?.payload as MatchedSegment;
                    return (
                      <div className="bg-white border border-gray-200 rounded p-2 text-xs shadow">
                        <div className="font-semibold">{d.date}</div>
                        <div>
                          {d.workoutLabel} — Lap {d.lapIndex}/{d.totalLaps} ({d.positionLabel})
                        </div>
                        <div>Pace: {d.paceLabel}/km</div>
                        <div>HR: {d.hr} bpm</div>
                        <div>Prior load: {d.priorLoadLabel} ({d.priorDistance} km)</div>
                        {d.priorAvgHR > 0 && <div>Prior avg HR: {d.priorAvgHR} bpm</div>}
                      </div>
                    );
                  }}
                />
                <Scatter
                  data={segments}
                  shape={(props) => {
                    const { cx, cy, payload } = props as unknown as {
                      cx: number;
                      cy: number;
                      payload: MatchedSegment;
                    };
                    return (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={5}
                        fill={payload.workoutColor}
                        stroke="#fff"
                        strokeWidth={1}
                        opacity={0.8}
                      />
                    );
                  }}
                />
              </ScatterChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-3 mt-2 justify-center">
              {Array.from(new Set(segments.map((s) => s.workoutType))).map((t) => (
                <div key={t} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ backgroundColor: WORKOUT_COLORS[t as keyof typeof WORKOUT_COLORS] }}
                  />
                  {WORKOUT_LABELS[t as keyof typeof WORKOUT_LABELS]}
                </div>
              ))}
            </div>
          </div>

          {/* Segments table */}
          <div className="bg-white rounded-lg border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 px-4 pt-4 mb-3">
              Matching Segments
            </h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-left">
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Workout</th>
                    <th className="px-3 py-2 font-semibold">Lap</th>
                    <th className="px-3 py-2 font-semibold">Position</th>
                    <th className="px-3 py-2 font-semibold">Pace</th>
                    <th className="px-3 py-2 font-semibold">HR</th>
                    <th className="px-3 py-2 font-semibold">Prior Load</th>
                    <th className="px-3 py-2 font-semibold">Prior Dist</th>
                    <th className="px-3 py-2 font-semibold">Prior Avg HR</th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((s, i) => (
                    <tr
                      key={`${s.activityId}-${s.lapIndex}-${i}`}
                      className="border-t border-gray-100 hover:bg-blue-50/50"
                    >
                      <td className="px-3 py-2 font-medium text-gray-900">{s.date}</td>
                      <td className="px-3 py-2">
                        <span
                          className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold text-white"
                          style={{ backgroundColor: s.workoutColor }}
                        >
                          {s.workoutLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {s.lapIndex}/{s.totalLaps}
                      </td>
                      <td className="px-3 py-2">{s.positionLabel}</td>
                      <td className="px-3 py-2 font-medium">{s.paceLabel}</td>
                      <td className="px-3 py-2 font-medium">{s.hr} bpm</td>
                      <td className="px-3 py-2">
                        <span
                          className="inline-block px-2 py-0.5 rounded text-xs font-medium text-white"
                          style={{
                            backgroundColor: LOAD_COLORS[s.priorLoadLabel] ?? "#6b7280",
                          }}
                        >
                          {s.priorLoadLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2">{s.priorDistance} km</td>
                      <td className="px-3 py-2">
                        {s.priorAvgHR > 0 ? `${s.priorAvgHR} bpm` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
