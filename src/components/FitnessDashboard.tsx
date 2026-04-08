import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
  Cell,
  ScatterChart,
  Scatter,
} from "recharts";
import type { ParsedActivity, WorkoutType } from "../types";
import { WORKOUT_LABELS, WORKOUT_COLORS } from "../types";
import {
  computeFitness,
  computeActivityEFs,
  type ActivityEF,
  type FitnessSummary,
} from "../fitness";

interface FitnessDashboardProps {
  activities: ParsedActivity[];
}

const TREND_ICONS: Record<string, string> = {
  improving: "↑",
  stable: "→",
  declining: "↓",
};

const TREND_COLORS: Record<string, string> = {
  improving: "#22c55e",
  stable: "#f59e0b",
  declining: "#ef4444",
};

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const color =
    score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : score >= 25 ? "#f97316" : "#ef4444";
  return (
    <div className="text-center">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className="relative inline-flex items-center justify-center w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
          <circle
            cx="40"
            cy="40"
            r="34"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="6"
          />
          <circle
            cx="40"
            cy="40"
            r="34"
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={`${(score / 100) * 213.6} 213.6`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute text-lg font-bold" style={{ color }}>
          {score}
        </span>
      </div>
    </div>
  );
}

function EFTrendChart({ fitness }: { fitness: FitnessSummary }) {
  const data = fitness.snapshots.map((s) => ({
    date: s.dateStr,
    ef: s.freshEF || s.rawEF,
    score: s.score,
  }));

  if (data.length < 2) return null;

  const peakEF = Math.max(...data.map((d) => d.ef));

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">
        Fitness Trend (Efficiency Factor)
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Rolling average of speed/HR across steady runs. Higher = fitter.
        Dashed line = your peak.
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis
            yAxisId="ef"
            tick={{ fontSize: 11 }}
            domain={["auto", "auto"]}
            label={{ value: "EF", angle: -90, position: "insideLeft", fontSize: 11 }}
          />
          <YAxis
            yAxisId="score"
            orientation="right"
            tick={{ fontSize: 11 }}
            domain={[0, 100]}
            label={{
              value: "Score",
              angle: 90,
              position: "insideRight",
              fontSize: 11,
            }}
          />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload as (typeof data)[0];
              return (
                <div className="bg-white border border-gray-200 rounded p-2 text-xs shadow">
                  <div className="font-semibold">{d.date}</div>
                  <div>EF: {d.ef.toFixed(2)}</div>
                  <div>Score: {d.score}/100</div>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine
            yAxisId="ef"
            y={peakEF}
            stroke="#22c55e"
            strokeDasharray="6 3"
            strokeWidth={1}
            label={{ value: "Peak", fontSize: 10, fill: "#22c55e" }}
          />
          <Area
            yAxisId="score"
            type="monotone"
            dataKey="score"
            name="Score"
            fill="#6366f1"
            fillOpacity={0.08}
            stroke="none"
          />
          <Line
            yAxisId="ef"
            type="monotone"
            dataKey="ef"
            name="Efficiency Factor"
            stroke="#6366f1"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "#6366f1" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function EFByWorkoutType({ activityEFs }: { activityEFs: ActivityEF[] }) {
  const grouped = useMemo(() => {
    const groups: Partial<Record<WorkoutType, ActivityEF[]>> = {};
    for (const a of activityEFs) {
      if (!groups[a.workoutType]) groups[a.workoutType] = [];
      groups[a.workoutType]!.push(a);
    }
    return Object.entries(groups)
      .filter(([, list]) => list.length >= 2)
      .map(([type, list]) => ({
        type: type as WorkoutType,
        data: list.map((a) => ({
          date: a.dateStr,
          ef: +a.ef.toFixed(2),
        })),
      }));
  }, [activityEFs]);

  if (grouped.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">
        EF Trend by Workout Type
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Compare efficiency across workout types. Easy/long runs are most stable for tracking.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {grouped.map(({ type, data }) => (
          <div key={type}>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: WORKOUT_COLORS[type] }}
              />
              <span className="text-xs font-medium text-gray-600">
                {WORKOUT_LABELS[type]} ({data.length} runs)
              </span>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <ComposedChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const d = payload[0]?.payload as (typeof data)[0];
                    return (
                      <div className="bg-white border border-gray-200 rounded p-2 text-xs shadow">
                        <div className="font-semibold">{d.date}</div>
                        <div>EF: {d.ef}</div>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="ef"
                  stroke={WORKOUT_COLORS[type]}
                  strokeWidth={2}
                  dot={{ r: 3, fill: WORKOUT_COLORS[type] }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </div>
  );
}

function CardiacDriftChart({ activityEFs }: { activityEFs: ActivityEF[] }) {
  const data = useMemo(
    () =>
      activityEFs
        .filter((a) => a.lapEFs.length >= 4)
        .map((a) => ({
          date: a.dateStr,
          drift: +((1 - a.driftRatio) * 100).toFixed(1),
          type: a.workoutType,
          color: WORKOUT_COLORS[a.workoutType],
          distance: +a.distance.toFixed(1),
        })),
    [activityEFs]
  );

  if (data.length < 2) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">
        Cardiac Drift per Activity
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        How much efficiency drops from first half to second half of each run.
        Lower drift = better endurance. Positive = HR drifted up.
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 11 }}
            label={{
              value: "Drift %",
              angle: -90,
              position: "insideLeft",
              fontSize: 11,
            }}
          />
          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 2" />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload as (typeof data)[0];
              return (
                <div className="bg-white border border-gray-200 rounded p-2 text-xs shadow">
                  <div className="font-semibold">{d.date}</div>
                  <div>
                    {WORKOUT_LABELS[d.type as WorkoutType]} — {d.distance} km
                  </div>
                  <div>
                    Drift: {d.drift > 0 ? "+" : ""}
                    {d.drift}%
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="drift" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.drift > 5 ? "#ef4444" : d.drift > 0 ? "#f59e0b" : "#22c55e"}
                opacity={0.8}
              />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function PaceVsEFScatter({ activityEFs }: { activityEFs: ActivityEF[] }) {
  const data = useMemo(
    () =>
      activityEFs.map((a) => ({
        pace: Math.round(1000 / a.avgSpeed),
        ef: +a.ef.toFixed(2),
        date: a.dateStr,
        type: a.workoutType,
        color: WORKOUT_COLORS[a.workoutType],
        hr: Math.round(a.avgHR),
      })),
    [activityEFs]
  );

  if (data.length < 3) return null;

  function paceLabel(secPerKm: number): string {
    const min = Math.floor(secPerKm / 60);
    const sec = Math.round(secPerKm % 60);
    return `${min}:${sec.toString().padStart(2, "0")}`;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">
        Pace vs Efficiency Factor
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        How efficient you are at each pace. Higher EF at faster pace = great shape.
        Color = workout type.
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 5, right: 20, bottom: 20, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="pace"
            type="number"
            tick={{ fontSize: 11 }}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => paceLabel(v)}
            label={{
              value: "Pace (min/km)",
              position: "insideBottom",
              offset: -10,
              fontSize: 11,
            }}
            reversed
          />
          <YAxis
            dataKey="ef"
            type="number"
            tick={{ fontSize: 11 }}
            domain={["auto", "auto"]}
            label={{ value: "EF", angle: -90, position: "insideLeft", fontSize: 11 }}
          />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload as (typeof data)[0];
              return (
                <div className="bg-white border border-gray-200 rounded p-2 text-xs shadow">
                  <div className="font-semibold">{d.date}</div>
                  <div>{WORKOUT_LABELS[d.type as WorkoutType]}</div>
                  <div>Pace: {paceLabel(d.pace)}/km</div>
                  <div>EF: {d.ef}</div>
                  <div>HR: {d.hr} bpm</div>
                </div>
              );
            }}
          />
          <Scatter
            data={data}
            shape={(props) => {
              const { cx, cy, payload } = props as unknown as {
                cx: number;
                cy: number;
                payload: (typeof data)[0];
              };
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={5}
                  fill={payload.color}
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
        {Array.from(new Set(data.map((d) => d.type))).map((t) => (
          <div key={t} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              style={{ backgroundColor: WORKOUT_COLORS[t] }}
            />
            {WORKOUT_LABELS[t]}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FitnessDashboard({ activities }: FitnessDashboardProps) {
  const fitness = useMemo(() => computeFitness(activities), [activities]);
  const allEFs = useMemo(() => computeActivityEFs(activities), [activities]);

  const [showAllActivities, setShowAllActivities] = useState(false);

  if (allEFs.length < 2) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-500">
        Need at least 2 activities with HR data to compute fitness trends.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Fitness Score</h2>
        <p className="text-sm text-gray-600 mb-4">
          Based on Efficiency Factor (speed ÷ HR) across your steady runs.
          Higher EF at the same effort = better fitness.
        </p>
      </div>

      {/* Score cards */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex flex-wrap items-center justify-around gap-6">
          <ScoreGauge score={fitness.currentScore} label="Current Form" />
          <ScoreGauge score={fitness.peakScore} label="Peak Form" />

          <div className="text-center">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Trend
            </div>
            <div
              className="text-3xl font-bold"
              style={{ color: TREND_COLORS[fitness.trend] }}
            >
              {TREND_ICONS[fitness.trend]}
            </div>
            <div
              className="text-xs font-medium capitalize"
              style={{ color: TREND_COLORS[fitness.trend] }}
            >
              {fitness.trend}
            </div>
          </div>

          <div className="text-center">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Current EF
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {fitness.currentFreshEF.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500">fresh segments</div>
          </div>

          <div className="text-center">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
              Best EF
            </div>
            <div className="text-2xl font-bold text-green-600">
              {fitness.bestFreshEF.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500">{fitness.peakDate}</div>
          </div>
        </div>
      </div>

      <EFTrendChart fitness={fitness} />
      <EFByWorkoutType activityEFs={allEFs} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PaceVsEFScatter activityEFs={allEFs} />
        <CardiacDriftChart activityEFs={allEFs} />
      </div>

      {/* Activity EF table */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="flex items-center justify-between px-4 pt-4 mb-3">
          <h3 className="text-sm font-semibold text-gray-700">
            Activity Efficiency Factors
          </h3>
          <button
            onClick={() => setShowAllActivities((v) => !v)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            {showAllActivities ? "Show less" : "Show all"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-left">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Distance</th>
                <th className="px-3 py-2 font-semibold">Avg HR</th>
                <th className="px-3 py-2 font-semibold">EF</th>
                <th className="px-3 py-2 font-semibold">Drift</th>
              </tr>
            </thead>
            <tbody>
              {(showAllActivities ? allEFs : allEFs.slice(-10))
                .slice()
                .reverse()
                .map((a) => (
                  <tr
                    key={a.id}
                    className="border-t border-gray-100 hover:bg-blue-50/50"
                  >
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {a.dateStr}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold text-white"
                        style={{
                          backgroundColor: WORKOUT_COLORS[a.workoutType],
                        }}
                      >
                        {WORKOUT_LABELS[a.workoutType]}
                      </span>
                    </td>
                    <td className="px-3 py-2">{a.distance.toFixed(1)} km</td>
                    <td className="px-3 py-2">{Math.round(a.avgHR)} bpm</td>
                    <td className="px-3 py-2 font-bold">{a.ef.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      {a.lapEFs.length >= 4 ? (
                        <span
                          className={
                            a.driftRatio < 0.95
                              ? "text-red-600"
                              : a.driftRatio < 1
                                ? "text-amber-600"
                                : "text-green-600"
                          }
                        >
                          {((1 - a.driftRatio) * 100).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
