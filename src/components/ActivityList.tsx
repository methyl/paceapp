import type { ParsedActivity, WorkoutType } from "../types";
import { WORKOUT_LABELS, WORKOUT_COLORS } from "../types";
import { formatTime } from "../parseFit";

interface ActivityListProps {
  activities: ParsedActivity[];
  onSelect: (activity: ParsedActivity) => void;
  filterType: WorkoutType | "all";
  onFilterChange: (type: WorkoutType | "all") => void;
}

function WorkoutBadge({ type }: { type: WorkoutType }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: WORKOUT_COLORS[type] }}
    >
      {WORKOUT_LABELS[type]}
    </span>
  );
}

export default function ActivityList({
  activities,
  onSelect,
  filterType,
  onFilterChange,
}: ActivityListProps) {
  const typeCounts = activities.reduce(
    (acc, a) => {
      acc[a.workoutType] = (acc[a.workoutType] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const filtered =
    filterType === "all"
      ? activities
      : activities.filter((a) => a.workoutType === filterType);

  const sorted = [...filtered].sort((a, b) => {
    const da = a.summary.startTime ? new Date(a.summary.startTime).getTime() : 0;
    const db = b.summary.startTime ? new Date(b.summary.startTime).getTime() : 0;
    return db - da;
  });

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => onFilterChange("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            filterType === "all"
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          All ({activities.length})
        </button>
        {Object.entries(typeCounts)
          .sort(([, a], [, b]) => b - a)
          .map(([type, count]) => (
            <button
              key={type}
              onClick={() => onFilterChange(type as WorkoutType)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterType === type
                  ? "text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              style={
                filterType === type
                  ? { backgroundColor: WORKOUT_COLORS[type as WorkoutType] }
                  : undefined
              }
            >
              {WORKOUT_LABELS[type as WorkoutType]} ({count})
            </button>
          ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600 text-left">
              <th className="px-3 py-2.5 font-semibold">Date</th>
              <th className="px-3 py-2.5 font-semibold">Type</th>
              <th className="px-3 py-2.5 font-semibold">Distance</th>
              <th className="px-3 py-2.5 font-semibold">Duration</th>
              <th className="px-3 py-2.5 font-semibold">Pace</th>
              <th className="px-3 py-2.5 font-semibold">Avg HR</th>
              <th className="px-3 py-2.5 font-semibold">Laps</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <tr
                key={a.id}
                onClick={() => onSelect(a)}
                className="border-t border-gray-100 hover:bg-blue-50/50 cursor-pointer transition-colors"
              >
                <td className="px-3 py-2.5 font-medium text-gray-900">
                  {a.summary.startTime
                    ? new Date(a.summary.startTime).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : a.fileName}
                </td>
                <td className="px-3 py-2.5">
                  <WorkoutBadge type={a.workoutType} />
                </td>
                <td className="px-3 py-2.5">
                  {(a.summary.totalDistance / 1000).toFixed(2)} km
                </td>
                <td className="px-3 py-2.5">
                  {formatTime(a.summary.totalElapsedTime)}
                </td>
                <td className="px-3 py-2.5 font-medium">{a.summary.avgPace}</td>
                <td className="px-3 py-2.5">
                  {a.summary.avgHeartRate != null
                    ? `${Math.round(a.summary.avgHeartRate)} bpm`
                    : "-"}
                </td>
                <td className="px-3 py-2.5">{a.laps.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { WorkoutBadge };
