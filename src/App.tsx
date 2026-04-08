import { useCallback, useEffect, useState } from "react";
import FileUpload from "./components/FileUpload";
import Summary from "./components/Summary";
import LapTable from "./components/LapTable";
import DynamicsCharts from "./components/DynamicsCharts";
import ActivityList from "./components/ActivityList";
import HRComparison from "./components/HRComparison";
import PaceComparison from "./components/PaceComparison";
import FitnessDashboard from "./components/FitnessDashboard";
import SegmentHistory from "./components/SegmentHistory";
import { parseFitFile, reprocessActivity } from "./parseFit";
import { loadActivities, saveActivities, clearActivities } from "./storage";
import { getZ2Ceiling, setZ2Ceiling } from "./detectWorkout";
import type { ParsedActivity, WorkoutType } from "./types";
import { WORKOUT_LABELS, WORKOUT_COLORS } from "./types";

type View = "library" | "detail" | "compare" | "pace" | "fitness";

function App() {
  const [activities, setActivities] = useState<ParsedActivity[]>([]);
  const [selected, setSelected] = useState<ParsedActivity | null>(null);
  const [view, setView] = useState<View>("library");
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [filterType, setFilterType] = useState<WorkoutType | "all">("all");
  const [showOriginalLaps, setShowOriginalLaps] = useState(false);
  const [z2, setZ2] = useState(getZ2Ceiling);

  // Load from IndexedDB on mount, re-run segmentation with latest algorithm
  useEffect(() => {
    loadActivities()
      .then((stored) => {
        if (stored.length > 0) {
          setActivities(stored.map(reprocessActivity));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Persist to IndexedDB when activities change
  useEffect(() => {
    if (activities.length > 0) {
      saveActivities(activities).catch(() => {});
    }
  }, [activities]);

  const handleFiles = useCallback(
    async (files: { buffer: ArrayBuffer; name: string }[]) => {
      setLoading(true);
      setError("");
      setLoadProgress({ done: 0, total: files.length });

      const parsed: ParsedActivity[] = [];
      let failed = 0;

      for (const f of files) {
        try {
          const activity = await parseFitFile(f.buffer, f.name);
          if (
            !activity.summary.sport ||
            activity.summary.sport === "running" ||
            activity.summary.sport === "trail_running"
          ) {
            parsed.push(activity);
          }
        } catch {
          failed++;
        }
        setLoadProgress((p) => ({ ...p, done: p.done + 1 }));
      }

      setActivities((prev) => {
        const existingNames = new Set(prev.map((a) => a.fileName));
        const newOnes = parsed.filter((a) => !existingNames.has(a.fileName));
        return [...prev, ...newOnes];
      });
      setLoading(false);

      if (failed > 0) {
        setError(`${failed} file(s) could not be parsed`);
      }

      if (parsed.length === 1 && activities.length === 0) {
        setSelected(parsed[0]);
        setView("detail");
      }
    },
    [activities.length]
  );

  const handleClear = useCallback(async () => {
    setActivities([]);
    setSelected(null);
    setView("library");
    await clearActivities().catch(() => {});
  }, []);

  const handleSelectActivity = (a: ParsedActivity) => {
    setSelected(a);
    setView("detail");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => {
              setView("library");
              setSelected(null);
            }}
            className="text-xl font-bold text-gray-900 tracking-tight hover:text-blue-600 transition-colors"
          >
            PaceApp
            <span className="text-sm font-normal text-gray-500 ml-2">
              Running Dynamics Analyzer
            </span>
          </button>

          {activities.length > 0 && (
            <nav className="flex items-center gap-2">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => {
                  setView("library");
                  setSelected(null);
                }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  view === "library"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Library
              </button>
              <button
                onClick={() => setView("compare")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  view === "compare"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Compare HR
              </button>
              <button
                onClick={() => setView("pace")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  view === "pace"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Pace Segments
              </button>
              <button
                onClick={() => setView("fitness")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  view === "fitness"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Fitness
              </button>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500 ml-2">
              <label htmlFor="z2">Z2:</label>
              <input
                id="z2"
                type="number"
                value={z2}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0) { setZ2(v); setZ2Ceiling(v); }
                }}
                className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-xs"
              />
              <span>bpm</span>
            </div>
            </nav>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Loading state */}
        {loading && loadProgress.total > 0 && (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-600 mt-3">
              Parsing FIT files... {loadProgress.done} / {loadProgress.total}
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && activities.length === 0 && (
          <div className="max-w-lg mx-auto mt-12">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-900 mb-2">
                Analyze Your Runs
              </h2>
              <p className="text-gray-600">
                Upload .FIT files or open a folder (like your iCloud Drive) to see
                running dynamics and compare heart rate across workouts.
              </p>
            </div>
            <FileUpload onFilesLoaded={handleFiles} multiple />
          </div>
        )}

        {/* Library view */}
        {!loading && activities.length > 0 && view === "library" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">
                {activities.length} run{activities.length !== 1 ? "s" : ""} loaded
              </h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleClear}
                  className="text-xs text-red-500 hover:text-red-700 font-medium"
                >
                  Clear all
                </button>
                <FileUpload onFilesLoaded={handleFiles} multiple />
              </div>
            </div>
            <ActivityList
              activities={activities}
              onSelect={handleSelectActivity}
              filterType={filterType}
              onFilterChange={setFilterType}
            />
          </>
        )}

        {/* Detail view */}
        {!loading && view === "detail" && selected && (
          <>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setView("library");
                  setSelected(null);
                }}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                &larr; Back to library
              </button>
              <span className="text-sm text-gray-400">|</span>
              <span
                className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: WORKOUT_COLORS[selected.workoutType] }}
              >
                {WORKOUT_LABELS[selected.workoutType]}
              </span>
              <span className="text-sm font-medium text-gray-700">{selected.workoutLabel}</span>
            </div>
            <Summary summary={selected.summary} />
            {selected.segmentsDetected && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-blue-800 text-sm">
                Auto-laps detected — showing {selected.segments.length} effort segments based on pace changes.
                <button
                  onClick={() => setShowOriginalLaps((v) => !v)}
                  className="ml-2 text-blue-600 underline text-xs"
                >
                  {showOriginalLaps ? "Show effort segments" : "Show original laps"}
                </button>
              </div>
            )}
            <LapTable
              laps={selected.segmentsDetected && !showOriginalLaps ? selected.segments : selected.laps}
              title={selected.segmentsDetected && !showOriginalLaps ? "Effort Segments" : "Segments / Laps"}
            />
            <DynamicsCharts
              laps={selected.segmentsDetected && !showOriginalLaps ? selected.segments : selected.laps}
              records={selected.records}
            />
            {activities.length >= 2 && (
              <SegmentHistory current={selected} allActivities={activities} />
            )}
          </>
        )}

        {/* Compare view */}
        {!loading && view === "compare" && activities.length > 0 && (
          <HRComparison activities={activities} />
        )}

        {/* Pace comparison view */}
        {!loading && view === "pace" && activities.length > 0 && (
          <PaceComparison activities={activities} />
        )}

        {/* Fitness dashboard */}
        {!loading && view === "fitness" && activities.length > 0 && (
          <FitnessDashboard activities={activities} />
        )}
      </main>
    </div>
  );
}

export default App;
