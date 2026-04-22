import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FileUpload from "./components/FileUpload";
import Summary from "./components/Summary";
import LapTable from "./components/LapTable";
import DynamicsCharts from "./components/DynamicsCharts";
import TimeSeriesChart from "./components/TimeSeriesChart";
import LibraryRail from "./components/LibraryRail";
import HRComparison from "./components/HRComparison";
import PaceComparison from "./components/PaceComparison";
import FitnessDashboard from "./components/FitnessDashboard";
import SegmentHistory from "./components/SegmentHistory";
import HillSprintsView from "./components/HillSprints";
import RouteMap from "./components/RouteMap";
import RunExtension from "./components/RunExtension";
import { useSnappedRoute } from "./routing";
import { parseFitFile, reprocessActivity } from "./parseFit";
import {
  loadActivities,
  saveActivities,
  clearActivities,
  saveFitBlob,
  deleteActivity as deleteActivityFromStorage,
} from "./storage";
import { api } from "./api/client";
import { exportActivityToFit, downloadFitFile } from "./exportFit";
import { getZ2Ceiling, setZ2Ceiling } from "./detectWorkout";
import type { ParsedActivity } from "./types";
import { WORKOUT_LABELS, WORKOUT_COLORS } from "./types";
import { useAuth } from "./api/useAuth";
import { useSync } from "./api/useSync";
import AuthBar from "./components/AuthBar";
import SyncPanel from "./components/SyncPanel";
import {
  classifyLaps,
  restBands,
  type LapFilter,
} from "./lapUtils";

type View = "library" | "compare" | "pace" | "fitness";

const VIEWS: { key: View; label: string }[] = [
  { key: "library", label: "Library" },
  { key: "compare", label: "Compare HR" },
  { key: "pace", label: "Pace Segments" },
  { key: "fitness", label: "Fitness" },
];

function App() {
  const [activities, setActivities] = useState<ParsedActivity[]>([]);
  const [selected, setSelected] = useState<ParsedActivity | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedCompareId, setPinnedCompareId] = useState<string | null>(null);
  const [view, setView] = useState<View>("library");
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [showOriginalLaps, setShowOriginalLaps] = useState(false);
  const [lapFilter, setLapFilter] = useState<LapFilter>("all");
  const [z2, setZ2] = useState(getZ2Ceiling);
  const [extensionWaypoints, setExtensionWaypoints] = useState<[number, number][]>([]);
  const [extensionMode, setExtensionMode] = useState(false);
  const snappedExtension = useSnappedRoute(extensionWaypoints);
  const [timeRange, setTimeRange] = useState<string>("all");

  const importInputRef = useRef<HTMLInputElement>(null);

  const auth = useAuth();
  const loggedIn = !!auth.user;
  const sync = useSync(loggedIn);

  const localFileNames = useMemo(
    () => new Set(activities.map((a) => a.fileName)),
    [activities]
  );
  const missingRemoteCount = useMemo(
    () => (sync.remote ?? []).filter((r) => !localFileNames.has(r.fileName)).length,
    [sync.remote, localFileNames]
  );

  const isRunning = (a: ParsedActivity) =>
    !a.summary.sport || a.summary.sport === "running" || a.summary.sport === "trail_running";

  const runningActivities = useMemo(
    () => activities.filter((a) => isRunning(a) && a.summary.totalDistance >= 500),
    [activities]
  );

  const timeFilteredRunning = useMemo(() => {
    if (timeRange === "all") return runningActivities;
    const now = Date.now();
    const days: Record<string, number> = { "30d": 30, "3m": 90, "6m": 180, "1y": 365 };
    const cutoff = now - (days[timeRange] ?? 365) * 24 * 60 * 60 * 1000;
    return runningActivities.filter((a) => {
      const t = a.summary.startTime ? new Date(a.summary.startTime).getTime() : 0;
      return t >= cutoff;
    });
  }, [runningActivities, timeRange]);

  const timeFilteredAll = useMemo(() => {
    if (timeRange === "all") return activities;
    const now = Date.now();
    const days: Record<string, number> = { "30d": 30, "3m": 90, "6m": 180, "1y": 365 };
    const cutoff = now - (days[timeRange] ?? 365) * 24 * 60 * 60 * 1000;
    return activities.filter((a) => {
      const t = a.summary.startTime ? new Date(a.summary.startTime).getTime() : 0;
      return t >= cutoff;
    });
  }, [activities, timeRange]);

  useEffect(() => {
    loadActivities()
      .then((stored) => {
        if (stored.length > 0) {
          const reprocessed = stored.map(reprocessActivity);
          setActivities(reprocessed);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activities.length > 0) {
      saveActivities(activities).catch(() => {});
    }
  }, [activities]);

  // Auto-select the most recent run on first load
  useEffect(() => {
    if (!selected && runningActivities.length > 0) {
      const sorted = [...runningActivities].sort((a, b) => {
        const da = a.summary.startTime ? new Date(a.summary.startTime).getTime() : 0;
        const db = b.summary.startTime ? new Date(b.summary.startTime).getTime() : 0;
        return db - da;
      });
      setSelected(sorted[0]);
    }
  }, [runningActivities, selected]);

  const handleDownloadMissing = useCallback(() => {
    sync.downloadMissing(localFileNames, (downloaded) => {
      const reprocessed = reprocessActivity(downloaded);
      setActivities((prev) => {
        if (prev.some((a) => a.fileName === reprocessed.fileName)) return prev;
        return [...prev, reprocessed];
      });
    });
  }, [sync, localFileNames]);

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
          parsed.push(activity);
          saveFitBlob(f.name, f.buffer).catch(() => {});
        } catch {
          failed++;
        }
        setLoadProgress((p) => ({ ...p, done: p.done + 1 }));
      }

      setActivities((prev) => {
        const byName = new Map(prev.map((a) => [a.fileName, a]));
        for (const a of parsed) byName.set(a.fileName, a);
        return Array.from(byName.values());
      });
      setLoading(false);

      if (failed > 0) setError(`${failed} file(s) could not be parsed`);

      if (parsed.length === 1 && activities.length === 0) {
        setSelected(parsed[0]);
      }
    },
    [activities.length]
  );

  const handleImportClick = () => importInputRef.current?.click();
  const handleImportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const promises = Array.from(files)
      .filter((f) => f.name.toLowerCase().endsWith(".fit"))
      .map(
        (f) =>
          new Promise<{ buffer: ArrayBuffer; name: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ buffer: reader.result as ArrayBuffer, name: f.name });
            reader.readAsArrayBuffer(f);
          })
      );
    Promise.all(promises).then(handleFiles);
    // Reset so choosing the same file again still fires change
    e.target.value = "";
  };

  const handleClear = useCallback(async () => {
    setActivities([]);
    setSelected(null);
    await clearActivities().catch(() => {});
  }, []);

  const handleDelete = useCallback(
    async (activity: ParsedActivity) => {
      const remoteMatch = (sync.remote ?? []).find((r) => r.fileName === activity.fileName);
      if (remoteMatch) {
        try {
          await api.deleteActivity(remoteMatch.id);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "failed to delete from cloud";
          if (!confirm(`Cloud delete failed: ${msg}\nRemove locally anyway?`)) return;
        }
      }
      await deleteActivityFromStorage(activity.fileName).catch(() => {});
      setActivities((prev) => prev.filter((a) => a.fileName !== activity.fileName));
      setSelected((s) => (s?.fileName === activity.fileName ? null : s));
      sync.refresh();
    },
    [sync]
  );

  const handleSelect = (a: ParsedActivity) => {
    setSelected(a);
    setView("library");
    setExtensionMode(false);
    setExtensionWaypoints([]);
  };

  const handleExtend = useCallback((extended: ParsedActivity) => {
    const reprocessed = reprocessActivity(extended);
    setActivities((prev) => prev.map((a) => (a.id === reprocessed.id ? reprocessed : a)));
    setSelected(reprocessed);
    setExtensionMode(false);
    setExtensionWaypoints([]);
  }, []);

  const handleUndoExtension = useCallback((original: ParsedActivity) => {
    const reprocessed = reprocessActivity(original);
    setActivities((prev) => prev.map((a) => (a.id === reprocessed.id ? reprocessed : a)));
    setSelected(reprocessed);
  }, []);

  const handleExport = useCallback(() => {
    if (!selected) return;
    const data = exportActivityToFit(selected);
    const date = selected.summary.startTime
      ? new Date(selected.summary.startTime).toISOString().slice(0, 10)
      : "export";
    downloadFitFile(data, `${date}-${selected.workoutType}.fit`);
  }, [selected]);

  const showEmptyState = !loading && activities.length === 0;

  // Compare run: pinned takes precedence over hover. Pinned sticks until the
  // user unpins; otherwise hover previews the comparison live.
  const hoveredRun = useMemo(
    () => (hoveredId ? activities.find((a) => a.id === hoveredId) ?? null : null),
    [hoveredId, activities]
  );
  const pinnedRun = useMemo(
    () =>
      pinnedCompareId ? activities.find((a) => a.id === pinnedCompareId) ?? null : null,
    [pinnedCompareId, activities]
  );
  const compareRun =
    pinnedRun && pinnedRun.id !== selected?.id
      ? pinnedRun
      : hoveredRun && selected && hoveredRun.id !== selected.id
      ? hoveredRun
      : null;

  const handleTogglePinCompare = useCallback(
    (a: ParsedActivity) => {
      setPinnedCompareId((cur) => (cur === a.id ? null : a.id));
    },
    []
  );
  const handleUnpinCompare = useCallback(() => setPinnedCompareId(null), []);

  // Auto-unpin if the pinned run becomes the selected run (no self-compare).
  useEffect(() => {
    if (pinnedCompareId && selected?.id === pinnedCompareId) {
      setPinnedCompareId(null);
    }
  }, [selected, pinnedCompareId]);

  return (
    <div className="app">
      {/* Hidden input for Import button */}
      <input
        ref={importInputRef}
        type="file"
        accept=".fit"
        multiple
        onChange={handleImportChange}
        style={{ display: "none" }}
      />

      {/* Top nav */}
      <nav className="nav">
        <div className="nav-inner">
          <div className="brand">
            <div className="brand-wordmark">
              <b>Pace</b>App
            </div>
            <div className="brand-tag">
              Running<br />Dynamics
            </div>
          </div>

          <div className="nav-tabs">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                className={`nav-tab ${view === v.key ? "active" : ""}`}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="nav-right">
            {!showEmptyState && activities.length > 0 && (
              <>
                <div className="nav-search" title="Search runs, segments…">
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx={11} cy={11} r={7} />
                    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                  </svg>
                  <span>Search runs…</span>
                  <span className="nav-kbd">⌘K</span>
                </div>
                <div className="seg" style={{ fontSize: 11 }}>
                  {["30d", "3m", "6m", "1y", "all"].map((r) => (
                    <button
                      key={r}
                      className={timeRange === r ? "active" : ""}
                      onClick={() => setTimeRange(r)}
                    >
                      {r === "all" ? "All" : r.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="nav-divider" />
                <div
                  className="row"
                  style={{ gap: 6, fontSize: 11, color: "var(--ink-3)" }}
                >
                  <label htmlFor="z2">Z2</label>
                  <input
                    id="z2"
                    type="number"
                    value={z2}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v > 0) {
                        setZ2(v);
                        setZ2Ceiling(v);
                      }
                    }}
                    style={{ width: 50, fontSize: 11 }}
                  />
                  <span>bpm</span>
                </div>
              </>
            )}
            <div className="nav-divider" />
            <button className="nav-new" onClick={handleImportClick} title="Import .fit files">
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              Import
            </button>
            <AuthBar
              user={auth.user}
              loading={auth.loading}
              onRequestLink={auth.requestLink}
              onLogout={auth.logout}
            />
          </div>
        </div>
      </nav>

      {showEmptyState ? (
        <main style={{ padding: "48px 24px", maxWidth: 620, margin: "0 auto" }}>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em" }}>
              Analyze your runs
            </h1>
            <p style={{ color: "var(--ink-3)", fontSize: 14, marginTop: 8 }}>
              Upload .FIT files to see running dynamics, compare heart rate across
              workouts, and track fitness over time.
            </p>
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            <SyncPanel
              loggedIn={loggedIn}
              localCount={activities.length}
              remote={sync.remote}
              progress={sync.progress}
              error={sync.remoteError}
              onImportAll={() => sync.importAll(activities)}
              onImportAllForce={() => sync.importAll(activities, { force: true })}
              onDownloadMissing={handleDownloadMissing}
              missingRemoteCount={missingRemoteCount}
            />
            <FileUpload onFilesLoaded={handleFiles} multiple />
          </div>
        </main>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "300px 1fr",
            height: "calc(100vh - 56px)",
            background: "#fff",
          }}
        >
          <LibraryRail
            activities={runningActivities}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
            onHover={(a) => setHoveredId(a?.id ?? null)}
            hoveredId={hoveredId}
            pinnedCompareId={pinnedCompareId}
            onTogglePinCompare={handleTogglePinCompare}
          />

          <main style={{ overflow: "auto", background: "#fff", minWidth: 0 }}>
            <div style={{ padding: "32px 32px 48px", maxWidth: 1180 }}>
              {loading && loadProgress.total > 0 && (
                <div style={{ color: "var(--ink-3)", fontSize: 13, marginBottom: 16 }}>
                  Parsing FIT files… {loadProgress.done} / {loadProgress.total}
                </div>
              )}
              {error && (
                <div
                  style={{
                    background: "color-mix(in oklch, var(--viz-4) 10%, transparent)",
                    border: "0.5px solid var(--hair)",
                    borderRadius: "var(--r-md)",
                    padding: 12,
                    fontSize: 13,
                    marginBottom: 16,
                  }}
                >
                  {error}
                </div>
              )}

              {view === "library" && selected && (
                <RunDetailView
                  activity={selected}
                  compareRun={compareRun}
                  comparePinned={!!(pinnedRun && pinnedRun.id === compareRun?.id)}
                  onUnpinCompare={handleUnpinCompare}
                  timeFilteredRunning={timeFilteredRunning}
                  showOriginalLaps={showOriginalLaps}
                  onToggleLaps={() => setShowOriginalLaps((v) => !v)}
                  lapFilter={lapFilter}
                  onLapFilterChange={setLapFilter}
                  extensionMode={extensionMode}
                  extensionWaypoints={extensionWaypoints}
                  onWaypointsChange={setExtensionWaypoints}
                  snappedExtension={snappedExtension}
                  onExtend={handleExtend}
                  onUndoExtension={handleUndoExtension}
                  onSetExtensionMode={setExtensionMode}
                  onExport={handleExport}
                  onDelete={() => {
                    if (
                      selected &&
                      confirm(
                        `Delete "${selected.fileName}"? This removes it locally${
                          sync.remote?.some((r) => r.fileName === selected.fileName)
                            ? " and from the cloud"
                            : ""
                        }.`
                      )
                    ) {
                      handleDelete(selected);
                    }
                  }}
                />
              )}

              {view === "library" && !selected && (
                <div
                  style={{
                    padding: "80px 0",
                    textAlign: "center",
                    color: "var(--ink-3)",
                    fontSize: 14,
                  }}
                >
                  Select a run from the left rail.
                </div>
              )}

              {view === "compare" && timeFilteredRunning.length > 0 && (
                <div>
                  <PageHeader title="Compare HR" subtitle={`${timeFilteredRunning.length} runs in range`} />
                  <HRComparison activities={timeFilteredRunning} />
                </div>
              )}

              {view === "pace" && timeFilteredRunning.length > 0 && (
                <div>
                  <PageHeader title="Pace Segments" subtitle={`${timeFilteredRunning.length} runs in range`} />
                  <PaceComparison activities={timeFilteredRunning} />
                </div>
              )}

              {view === "fitness" && timeFilteredAll.length > 0 && (
                <div>
                  <PageHeader title="Fitness" subtitle={`${timeFilteredAll.length} activities`} />
                  <FitnessDashboard activities={timeFilteredAll} />
                </div>
              )}

              <div style={{ marginTop: 48, paddingTop: 24, borderTop: "0.5px solid var(--hair)" }}>
                <div className="row between" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  <div>
                    <button className="btn btn-sm" onClick={handleClear}>
                      Clear all
                    </button>
                  </div>
                  <FileUpload onFilesLoaded={handleFiles} multiple />
                </div>
                <div style={{ marginTop: 16 }}>
                  <SyncPanel
                    loggedIn={loggedIn}
                    localCount={activities.length}
                    remote={sync.remote}
                    progress={sync.progress}
                    error={sync.remoteError}
                    onImportAll={() => sync.importAll(activities)}
                    onImportAllForce={() => sync.importAll(activities, { force: true })}
                    onDownloadMissing={handleDownloadMissing}
                    missingRemoteCount={missingRemoteCount}
                  />
                </div>
              </div>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}

interface RunDetailViewProps {
  activity: ParsedActivity;
  compareRun: ParsedActivity | null;
  comparePinned: boolean;
  onUnpinCompare: () => void;
  timeFilteredRunning: ParsedActivity[];
  showOriginalLaps: boolean;
  onToggleLaps: () => void;
  lapFilter: LapFilter;
  onLapFilterChange: (f: LapFilter) => void;
  extensionMode: boolean;
  extensionWaypoints: [number, number][];
  onWaypointsChange: (pts: [number, number][]) => void;
  snappedExtension: ReturnType<typeof useSnappedRoute>;
  onExtend: (a: ParsedActivity) => void;
  onUndoExtension: (a: ParsedActivity) => void;
  onSetExtensionMode: (v: boolean) => void;
  onExport: () => void;
  onDelete: () => void;
}

function RunDetailView({
  activity,
  compareRun,
  comparePinned,
  onUnpinCompare,
  timeFilteredRunning,
  showOriginalLaps,
  onToggleLaps,
  lapFilter,
  onLapFilterChange,
  extensionMode,
  extensionWaypoints,
  onWaypointsChange,
  snappedExtension,
  onExtend,
  onUndoExtension,
  onSetExtensionMode,
  onExport,
  onDelete,
}: RunDetailViewProps) {
  const date = activity.summary.startTime
    ? new Date(activity.summary.startTime).toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : activity.fileName;

  const typeColor = WORKOUT_COLORS[activity.workoutType];
  const typeLabel = WORKOUT_LABELS[activity.workoutType];

  const lapsSource = useMemo(
    () =>
      activity.segmentsDetected && !showOriginalLaps ? activity.segments : activity.laps,
    [activity, showOriginalLaps]
  );
  const cmpLapsSource = useMemo(() => {
    if (!compareRun) return null;
    return compareRun.segmentsDetected && !showOriginalLaps
      ? compareRun.segments
      : compareRun.laps;
  }, [compareRun, showOriginalLaps]);

  const kinds = useMemo(
    () => classifyLaps(lapsSource, activity.workoutType),
    [lapsSource, activity.workoutType]
  );
  const rests = useMemo(
    () => (lapFilter === "all" ? restBands(lapsSource, kinds) : []),
    [lapsSource, kinds, lapFilter]
  );

  const compareLabel = compareRun?.workoutLabel || compareRun?.fileName || null;

  return (
    <div>
      <div className="page-title">
        <div style={{ minWidth: 0 }}>
          <div
            className="row"
            style={{ gap: 10, marginBottom: 8, fontSize: 12, color: "var(--ink-3)" }}
          >
            <span
              className="tag"
              style={{
                background: `color-mix(in oklch, ${typeColor} 14%, transparent)`,
                color: typeColor,
              }}
            >
              <span className="dot" style={{ background: typeColor }} />
              {typeLabel}
            </span>
            <span>{date}</span>
          </div>
          <h1 style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {activity.workoutLabel || activity.fileName}
          </h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm" onClick={onExport}>
            Export FIT
          </button>
          <button className="btn btn-sm btn-danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      <Summary
        summary={activity.summary}
        compare={compareRun?.summary ?? null}
        compareLabel={compareLabel}
        comparePinned={comparePinned}
        onUnpinCompare={onUnpinCompare}
      />

      <div className="card" style={{ overflow: "hidden", marginBottom: 24 }}>
        <RouteMap
          records={activity.records}
          height={extensionMode ? 400 : 260}
          editMode={extensionMode}
          waypoints={extensionWaypoints}
          onWaypointsChange={onWaypointsChange}
          snappedPath={snappedExtension.route?.coordinates}
          snappedDistance={snappedExtension.route?.distance}
        />
      </div>

      <div className="row" style={{ gap: 12, marginBottom: 20 }}>
        <RunExtension
          activity={activity}
          onExtend={onExtend}
          onUndo={onUndoExtension}
          waypoints={extensionWaypoints}
          onWaypointsChange={onWaypointsChange}
          _editMode={extensionMode}
          onEditModeChange={onSetExtensionMode}
          snappedRoute={snappedExtension.route}
          routeLoading={snappedExtension.loading}
          routeError={snappedExtension.error}
        />
      </div>

      <TimeSeriesChart
        records={activity.records}
        laps={lapsSource}
        compareRecords={compareRun?.records ?? null}
        compareLaps={cmpLapsSource}
        compareLabel={compareLabel}
        restBands={rests.length > 0 ? rests : undefined}
      />

      {activity.segmentsDetected && (
        <div
          style={{
            background: "var(--bg-sunk)",
            border: "0.5px solid var(--hair)",
            borderRadius: "var(--r-md)",
            padding: "10px 14px",
            fontSize: 12.5,
            color: "var(--ink-2)",
            marginBottom: 16,
          }}
        >
          Auto-laps detected — showing {activity.segments.length} effort segments
          based on pace changes.
          <button
            onClick={onToggleLaps}
            className="link"
            style={{ marginLeft: 8, background: "transparent", border: 0 }}
          >
            {showOriginalLaps ? "Show effort segments" : "Show original laps"}
          </button>
        </div>
      )}

      <LapTable
        laps={lapsSource}
        workoutType={activity.workoutType}
        compareLaps={cmpLapsSource}
        compareWorkoutType={compareRun?.workoutType}
        kinds={kinds}
        filter={lapFilter}
        onFilterChange={onLapFilterChange}
        title={activity.segmentsDetected && !showOriginalLaps ? "Effort Segments" : "Laps"}
      />

      <DynamicsCharts
        laps={lapsSource}
        workoutType={activity.workoutType}
        kinds={kinds}
        filter={lapFilter}
        compareLaps={cmpLapsSource}
        compareWorkoutType={compareRun?.workoutType}
        compareLabel={compareLabel}
      />

      <div style={{ marginTop: 24 }}>
        <HillSprintsView activity={activity} />
      </div>

      {timeFilteredRunning.length >= 2 && (
        <div style={{ marginTop: 24 }}>
          <SegmentHistory current={activity} allActivities={timeFilteredRunning} />
        </div>
      )}
    </div>
  );
}

export default App;
