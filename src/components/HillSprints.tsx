import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import type { ParsedActivity } from "../types";
import { detectHillSprints } from "../hillSprints";

interface HillSprintsProps {
  activity: ParsedActivity;
}

export default function HillSprintsView({ activity }: HillSprintsProps) {
  const sprints = useMemo(
    () => detectHillSprints(activity.records),
    [activity.records]
  );

  if (sprints.length === 0) return null;

  const data = sprints.map((s, i) => ({
    name: `${i + 1}`,
    grade: s.grade,
    distance: s.distance,
    elevation: s.elevationGain,
    pace: s.avgPace,
    hr: s.avgHeartRate,
    duration: s.duration,
  }));

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Hill Sprints</h2>
      <p className="text-sm text-gray-600 mb-4">
        {sprints.length} uphill segment{sprints.length !== 1 ? "s" : ""} detected (min 3% grade, 50m).
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Grade per Sprint</h3>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0]?.payload as (typeof data)[0];
                  return (
                    <div className="bg-white border border-gray-200 rounded p-2 text-xs shadow">
                      <div className="font-semibold">Sprint {d.name}</div>
                      <div>Grade: {d.grade}%</div>
                      <div>Distance: {d.distance}m</div>
                      <div>Elevation: +{d.elevation}m</div>
                      <div>Pace: {d.pace}/km</div>
                      {d.hr && <div>HR: {d.hr} bpm</div>}
                    </div>
                  );
                }}
              />
              <Bar dataKey="grade" radius={[4, 4, 0, 0]}>
                {data.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.grade > 8 ? "#ef4444" : d.grade > 5 ? "#f59e0b" : "#22c55e"}
                    opacity={0.85}
                  />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Elevation Gain per Sprint</h3>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="m" />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0]?.payload as (typeof data)[0];
                  return (
                    <div className="bg-white border border-gray-200 rounded p-2 text-xs shadow">
                      <div className="font-semibold">Sprint {d.name}</div>
                      <div>+{d.elevation}m in {d.distance}m</div>
                      <div>Pace: {d.pace}/km | {d.duration}s</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="elevation" fill="#6366f1" radius={[4, 4, 0, 0]} opacity={0.85} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-left">
              <th className="px-3 py-2 font-semibold">#</th>
              <th className="px-3 py-2 font-semibold">Distance</th>
              <th className="px-3 py-2 font-semibold">Elevation</th>
              <th className="px-3 py-2 font-semibold">Grade</th>
              <th className="px-3 py-2 font-semibold">Duration</th>
              <th className="px-3 py-2 font-semibold">Pace</th>
              <th className="px-3 py-2 font-semibold">HR</th>
            </tr>
          </thead>
          <tbody>
            {sprints.map((s, i) => (
              <tr key={i} className="border-t border-gray-100 hover:bg-blue-50/50">
                <td className="px-3 py-2 font-medium">{i + 1}</td>
                <td className="px-3 py-2">{s.distance}m</td>
                <td className="px-3 py-2">+{s.elevationGain}m</td>
                <td className="px-3 py-2 font-medium">{s.grade}%</td>
                <td className="px-3 py-2">{s.duration}s</td>
                <td className="px-3 py-2">{s.avgPace}/km</td>
                <td className="px-3 py-2">{s.avgHeartRate ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
