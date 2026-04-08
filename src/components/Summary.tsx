import type { ActivitySummary } from "../types";
import { formatTime } from "../parseFit";

interface SummaryProps {
  summary: ActivitySummary;
}

function StatCard({ label, value, unit }: { label: string; value: string | number | undefined; unit?: string }) {
  if (value == null || value === "-") return null;
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-1">
        {typeof value === "number" ? value.toFixed(1) : value}
        {unit && <span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>}
      </div>
    </div>
  );
}

export default function Summary({ summary }: SummaryProps) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-xl font-bold text-gray-900">
          {summary.sport ? summary.sport.charAt(0).toUpperCase() + summary.sport.slice(1) : "Activity"} Summary
        </h2>
        {summary.startTime && (
          <span className="text-sm text-gray-500">
            {new Date(summary.startTime).toLocaleDateString(undefined, {
              weekday: "short",
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <StatCard label="Distance" value={(summary.totalDistance / 1000).toFixed(2)} unit="km" />
        <StatCard label="Duration" value={formatTime(summary.totalElapsedTime)} />
        <StatCard label="Avg Pace" value={summary.avgPace} unit="/km" />
        <StatCard label="Avg Heart Rate" value={summary.avgHeartRate} unit="bpm" />
        <StatCard label="Avg Cadence" value={summary.avgCadence} unit="spm" />
        <StatCard label="Avg Vert. Oscillation" value={summary.avgVerticalOscillation} unit="mm" />
        <StatCard label="Avg Ground Contact" value={summary.avgGroundContactTime} unit="ms" />
        <StatCard label="Avg Stride Length" value={summary.avgStrideLength != null ? (summary.avgStrideLength / 1000).toFixed(2) : undefined} unit="m" />
        <StatCard label="Avg Vertical Ratio" value={summary.avgVerticalRatio} unit="%" />
        <StatCard label="Avg Power" value={summary.avgPower} unit="W" />
      </div>
    </div>
  );
}
