import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
} from "recharts";
import type { ParsedActivity, WorkoutType } from "../types";
import { WORKOUT_LABELS, WORKOUT_COLORS } from "../types";

interface HRComparisonProps {
  activities: ParsedActivity[];
}

/** Group activities by workout type */
function groupByType(activities: ParsedActivity[]) {
  const groups: Partial<Record<WorkoutType, ParsedActivity[]>> = {};
  for (const a of activities) {
    if (!groups[a.workoutType]) groups[a.workoutType] = [];
    groups[a.workoutType]!.push(a);
  }
  return groups;
}

/** Pace bucket key: round to nearest 10 sec/km */
function paceBucket(speedMps: number): number {
  if (!speedMps || speedMps <= 0) return 0;
  const secPerKm = 1000 / speedMps;
  return Math.round(secPerKm / 10) * 10;
}

function paceLabel(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

/** Generate date-based color gradient for a list of activities */
function dateColors(activities: ParsedActivity[]): Map<string, string> {
  const sorted = [...activities].sort((a, b) => {
    const da = a.summary.startTime ? new Date(a.summary.startTime).getTime() : 0;
    const db = b.summary.startTime ? new Date(b.summary.startTime).getTime() : 0;
    return da - db;
  });
  const colors = new Map<string, string>();
  sorted.forEach((a, i) => {
    const t = sorted.length > 1 ? i / (sorted.length - 1) : 0.5;
    // Blue (old) -> Green (recent)
    const r = Math.round(30 + (1 - t) * 100);
    const g = Math.round(80 + t * 175);
    const b = Math.round(220 - t * 100);
    colors.set(a.id, `rgb(${r},${g},${b})`);
  });
  return colors;
}

/** HR vs Pace scatter for a workout type group */
function HRvsPaceScatter({ activities, type }: { activities: ParsedActivity[]; type: WorkoutType }) {
  const colors = useMemo(() => dateColors(activities), [activities]);

  const data = useMemo(() => {
    const points: { pace: number; hr: number; date: string; id: string; color: string }[] = [];
    for (const a of activities) {
      const avgSpeed = a.summary.avgSpeed;
      const avgHR = a.summary.avgHeartRate;
      if (!avgSpeed || !avgHR) continue;
      const secPerKm = 1000 / avgSpeed;
      points.push({
        pace: +secPerKm.toFixed(0),
        hr: Math.round(avgHR),
        date: a.summary.startTime
          ? new Date(a.summary.startTime).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })
          : a.fileName,
        id: a.id,
        color: colors.get(a.id) ?? WORKOUT_COLORS[type],
      });
    }
    return points;
  }, [activities, colors, type]);

  if (data.length < 2) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">
        {WORKOUT_LABELS[type]}: HR vs Pace
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Each dot is one run. Color: blue (oldest) to green (newest). Lower HR at same pace = fitter.
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 5, right: 20, bottom: 20, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="pace"
            type="number"
            name="Pace"
            tick={{ fontSize: 11 }}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => paceLabel(v)}
            label={{ value: "Pace (min/km)", position: "insideBottom", offset: -10, fontSize: 11 }}
            reversed
          />
          <YAxis
            dataKey="hr"
            type="number"
            name="HR"
            tick={{ fontSize: 11 }}
            domain={["auto", "auto"]}
            label={{ value: "Avg HR (bpm)", angle: -90, position: "insideLeft", fontSize: 11 }}
          />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload as (typeof data)[0];
              return (
                <div className="bg-white border border-gray-200 rounded p-2 text-xs shadow">
                  <div className="font-semibold">{d.date}</div>
                  <div>Pace: {paceLabel(d.pace)} /km</div>
                  <div>HR: {d.hr} bpm</div>
                </div>
              );
            }}
          />
          <Scatter
            data={data}
            fill={WORKOUT_COLORS[type]}
            shape={(props) => {
              const { cx, cy, payload } = props as unknown as {
                cx: number;
                cy: number;
                payload: (typeof data)[0];
              };
              return (
                <circle cx={cx} cy={cy} r={6} fill={payload.color} stroke="#fff" strokeWidth={1} opacity={0.85} />
              );
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/** HR trend over time for activities at similar pace */
function HRTrendChart({ activities, type }: { activities: ParsedActivity[]; type: WorkoutType }) {
  const data = useMemo(() => {
    const sorted = [...activities]
      .filter((a) => a.summary.avgHeartRate != null && a.summary.startTime)
      .sort(
        (a, b) =>
          new Date(a.summary.startTime!).getTime() -
          new Date(b.summary.startTime!).getTime()
      );

    return sorted.map((a) => ({
      date: new Date(a.summary.startTime!).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      hr: Math.round(a.summary.avgHeartRate!),
      pace: a.summary.avgSpeed ? +(1000 / a.summary.avgSpeed).toFixed(0) : null,
    }));
  }, [activities]);

  if (data.length < 2) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">
        {WORKOUT_LABELS[type]}: HR Trend Over Time
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Avg HR per run over time. Declining trend at similar pace = improving fitness.
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fontSize: 11 }}
            label={{ value: "Avg HR", angle: -90, position: "insideLeft", fontSize: 11 }}
          />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload as (typeof data)[0];
              return (
                <div className="bg-white border border-gray-200 rounded p-2 text-xs shadow">
                  <div className="font-semibold">{d.date}</div>
                  <div>HR: {d.hr} bpm</div>
                  {d.pace && <div>Pace: {paceLabel(d.pace)} /km</div>}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="hr"
            name="Avg HR"
            stroke={WORKOUT_COLORS[type]}
            strokeWidth={2}
            dot={{ r: 4, fill: WORKOUT_COLORS[type] }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** HR comparison across pace buckets (all workout types) */
function HRByPaceBucket({ activities }: { activities: ParsedActivity[] }) {
  const data = useMemo(() => {
    const buckets: Record<number, { hrs: number[]; dates: string[] }> = {};
    for (const a of activities) {
      if (!a.summary.avgSpeed || !a.summary.avgHeartRate) continue;
      const bucket = paceBucket(a.summary.avgSpeed);
      if (bucket < 180 || bucket > 480) continue; // filter unrealistic paces
      if (!buckets[bucket]) buckets[bucket] = { hrs: [], dates: [] };
      buckets[bucket].hrs.push(a.summary.avgHeartRate);
      buckets[bucket].dates.push(a.summary.startTime ?? "");
    }
    return Object.entries(buckets)
      .filter(([, v]) => v.hrs.length >= 2)
      .map(([pace, v]) => ({
        pace: +pace,
        paceLabel: paceLabel(+pace),
        avgHR: Math.round(v.hrs.reduce((s, h) => s + h, 0) / v.hrs.length),
        minHR: Math.round(Math.min(...v.hrs)),
        maxHR: Math.round(Math.max(...v.hrs)),
        count: v.hrs.length,
      }))
      .sort((a, b) => b.pace - a.pace); // slowest first (high sec/km)
  }, [activities]);

  if (data.length < 2) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">
        Average HR by Pace Bucket (All Runs)
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Groups runs by similar pace and shows average HR. Useful for spotting cardiac drift patterns.
      </p>
      <ResponsiveContainer width="100%" height={250}>
        <ScatterChart margin={{ top: 5, right: 20, bottom: 20, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="pace"
            type="number"
            tick={{ fontSize: 11 }}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => paceLabel(v)}
            label={{ value: "Pace (min/km)", position: "insideBottom", offset: -10, fontSize: 11 }}
            reversed
          />
          <YAxis
            dataKey="avgHR"
            type="number"
            tick={{ fontSize: 11 }}
            domain={["auto", "auto"]}
            label={{ value: "Avg HR (bpm)", angle: -90, position: "insideLeft", fontSize: 11 }}
          />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload as (typeof data)[0];
              return (
                <div className="bg-white border border-gray-200 rounded p-2 text-xs shadow">
                  <div className="font-semibold">Pace: {d.paceLabel} /km</div>
                  <div>Avg HR: {d.avgHR} bpm</div>
                  <div>Range: {d.minHR}–{d.maxHR} bpm</div>
                  <div>{d.count} runs</div>
                </div>
              );
            }}
          />
          <Scatter data={data} fill="#6366f1">
            {data.map((d, i) => (
              <circle key={i} r={Math.min(4 + d.count, 12)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function HRComparison({ activities }: HRComparisonProps) {
  const [selectedType, setSelectedType] = useState<WorkoutType | "all">("all");

  const groups = useMemo(() => groupByType(activities), [activities]);
  const withHR = activities.filter((a) => a.summary.avgHeartRate != null);

  if (withHR.length < 2) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-500">
        Need at least 2 activities with heart rate data for comparison.
      </div>
    );
  }

  const typeOptions = Object.keys(groups) as WorkoutType[];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">HR Comparison</h2>
        <p className="text-sm text-gray-600 mb-4">
          Compare heart rate across similar workouts to track fitness changes.
        </p>

        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setSelectedType("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              selectedType === "all"
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All Types
          </button>
          {typeOptions.map((t) => (
            <button
              key={t}
              onClick={() => setSelectedType(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedType === t
                  ? "text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              style={
                selectedType === t ? { backgroundColor: WORKOUT_COLORS[t] } : undefined
              }
            >
              {WORKOUT_LABELS[t]} ({groups[t]!.length})
            </button>
          ))}
        </div>
      </div>

      {/* Overall pace vs HR */}
      {selectedType === "all" && <HRByPaceBucket activities={withHR} />}

      {/* Per-type charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {typeOptions
          .filter((t) => selectedType === "all" || selectedType === t)
          .filter((t) => groups[t]!.filter((a) => a.summary.avgHeartRate != null).length >= 2)
          .map((t) => (
            <HRvsPaceScatter key={`scatter-${t}`} activities={groups[t]!} type={t} />
          ))}
        {typeOptions
          .filter((t) => selectedType === "all" || selectedType === t)
          .filter((t) => groups[t]!.filter((a) => a.summary.avgHeartRate != null).length >= 2)
          .map((t) => (
            <HRTrendChart key={`trend-${t}`} activities={groups[t]!} type={t} />
          ))}
      </div>
    </div>
  );
}
