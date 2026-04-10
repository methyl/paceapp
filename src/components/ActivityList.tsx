import type { ParsedActivity, WorkoutType } from "../types";
import { WORKOUT_LABELS, WORKOUT_COLORS } from "../types";
import { formatTime } from "../parseFit";
import MiniRouteMap from "./MiniRouteMap";

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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map((a) => (
          <div
            key={a.id}
            onClick={() => onSelect(a)}
            className="bg-white rounded-lg border border-gray-200 overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
          >
            <MiniRouteMap
              records={a.records}
              color={WORKOUT_COLORS[a.workoutType]}
              height={130}
            />
            <div className="p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-900">
                  {a.summary.startTime
                    ? new Date(a.summary.startTime).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    : a.fileName}
                </span>
                <WorkoutBadge type={a.workoutType} />
              </div>
              <div className="text-xs text-gray-600 truncate mb-2" title={a.workoutLabel}>
                {a.workoutLabel}
              </div>
              <div className="flex gap-3 text-xs text-gray-500">
                <span>{(a.summary.totalDistance / 1000).toFixed(1)} km</span>
                <span>{formatTime(a.summary.totalElapsedTime)}</span>
                <span>{a.summary.avgPace}/km</span>
                {a.summary.avgHeartRate != null && (
                  <span>{Math.round(a.summary.avgHeartRate)} bpm</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { WorkoutBadge };
