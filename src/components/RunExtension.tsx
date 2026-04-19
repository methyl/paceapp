import { useState, useMemo } from "react";
import type { ParsedActivity } from "../types";
import { haversineDistance, synthesizeRecords } from "../synthesizeExtension";
import { speedToPace, formatTime } from "../parseFit";

interface RunExtensionProps {
  activity: ParsedActivity;
  onExtend: (extended: ParsedActivity) => void;
  onUndo: (original: ParsedActivity) => void;
  waypoints: [number, number][];
  onWaypointsChange: (wp: [number, number][]) => void;
  _editMode?: boolean;
  onEditModeChange: (mode: boolean) => void;
}

function parseTimeInput(input: string): number | null {
  const parts = input.trim().split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

export default function RunExtension({
  activity, onExtend, onUndo,
  waypoints, onWaypointsChange,
  onEditModeChange,
}: RunExtensionProps) {
  const [mode, setModeInternal] = useState<"idle" | "drawing" | "preview">("idle");

  const setMode = (m: "idle" | "drawing" | "preview") => {
    setModeInternal(m);
    onEditModeChange(m === "drawing");
  };
  const [timeInput, setTimeInput] = useState("");
  const [error, setError] = useState("");

  const hasGps = activity.records.some((r) => r.lat != null);
  const lastRecord = activity.records[activity.records.length - 1];
  const currentElapsed = lastRecord?.elapsed ?? 0;

  const extensionDist = useMemo(() => {
    if (waypoints.length < 2) return 0;
    let d = 0;
    for (let i = 1; i < waypoints.length; i++) {
      d += haversineDistance(
        waypoints[i - 1][0], waypoints[i - 1][1],
        waypoints[i][0], waypoints[i][1]
      );
    }
    return d;
  }, [waypoints]);

  const finishTime = parseTimeInput(timeInput);
  const extensionTime = finishTime != null ? finishTime - currentElapsed : null;
  const impliedPace = extensionTime && extensionDist > 0
    ? speedToPace(extensionDist / extensionTime)
    : null;

  const handlePreview = () => {
    setError("");
    if (!hasGps && waypoints.length < 2) {
      setError("Add at least 2 waypoints on the map");
      return;
    }
    if (finishTime == null || finishTime <= currentElapsed) {
      setError(`Total time must be greater than current ${formatTime(currentElapsed)}`);
      return;
    }
    if (waypoints.length < 2) {
      setError("Add at least 2 waypoints on the map");
      return;
    }
    setMode("preview");
  };

  const handleConfirm = () => {
    if (finishTime == null) return;

    const synthetic = synthesizeRecords({
      existingRecords: activity.records,
      waypoints,
      totalFinishTimeSeconds: finishTime,
    });

    if (synthetic.length === 0) {
      setError("Could not generate extension data");
      return;
    }

    const mergedRecords = [...activity.records, ...synthetic];
    const lastMerged = mergedRecords[mergedRecords.length - 1];

    const extended: ParsedActivity = {
      ...activity,
      records: mergedRecords,
      originalRecordCount: activity.records.length,
      extended: true,
      summary: {
        ...activity.summary,
        totalDistance: lastMerged.distance,
        totalElapsedTime: lastMerged.elapsed,
        avgSpeed: lastMerged.distance / lastMerged.elapsed,
        avgPace: speedToPace(lastMerged.distance / lastMerged.elapsed),
      },
    };

    onExtend(extended);
    setMode("idle");
    onWaypointsChange([]);
    setTimeInput("");
  };

  const handleCancel = () => {
    setMode("idle");
    onWaypointsChange([]);
    setTimeInput("");
    setError("");
  };

  // Already extended — show undo
  if (activity.extended) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-amber-600 font-medium">Extended activity</span>
        <button
          onClick={() => {
            const original: ParsedActivity = {
              ...activity,
              records: activity.records.slice(0, activity.originalRecordCount),
              extended: false,
              originalRecordCount: undefined,
            };
            onUndo(original);
          }}
          className="text-xs text-red-500 hover:text-red-700 font-medium"
        >
          Undo extension
        </button>
      </div>
    );
  }

  if (mode === "idle") {
    return hasGps ? (
      <button
        onClick={() => setMode("drawing")}
        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
      >
        Extend Run (watch died?)
      </button>
    ) : null;
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-blue-900">
          {mode === "drawing" ? "Trace the rest of your route" : "Preview Extension"}
        </h3>
        <button onClick={handleCancel} className="text-xs text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>

      {mode === "drawing" && (
        <>
          <p className="text-xs text-blue-700">
            Click on the map to add waypoints. Drag to adjust. Right-click to delete.
          </p>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Total finish time
              </label>
              <input
                type="text"
                value={timeInput}
                onChange={(e) => setTimeInput(e.target.value)}
                placeholder="H:MM:SS or MM:SS"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-32"
              />
              <div className="text-[10px] text-gray-500 mt-0.5">
                Current: {formatTime(currentElapsed)}
              </div>
            </div>

            {extensionDist > 0 && (
              <div className="text-xs text-gray-600">
                <div>Extension: {(extensionDist / 1000).toFixed(2)} km</div>
                {impliedPace && <div>Implied pace: {impliedPace}/km</div>}
                {extensionTime != null && extensionTime > 0 && (
                  <div>Extension time: {formatTime(extensionTime)}</div>
                )}
              </div>
            )}

            <button
              onClick={handlePreview}
              disabled={waypoints.length < 2 || finishTime == null}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Preview
            </button>
          </div>

          {error && <div className="text-xs text-red-600">{error}</div>}
        </>
      )}

      {mode === "preview" && (
        <>
          <div className="text-sm text-gray-700 space-y-1">
            <div>
              +{(extensionDist / 1000).toFixed(2)} km, +{formatTime(extensionTime ?? 0)}
            </div>
            <div>
              New total: {((lastRecord?.distance ?? 0 + extensionDist) / 1000).toFixed(2)} km
              in {formatTime(finishTime ?? 0)}
            </div>
            {impliedPace && <div>Extension pace: {impliedPace}/km</div>}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              className="px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700"
            >
              Save Extension
            </button>
            <button
              onClick={() => setMode("drawing")}
              className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-sm font-medium hover:bg-gray-300"
            >
              Back to Edit
            </button>
          </div>

          {error && <div className="text-xs text-red-600">{error}</div>}
        </>
      )}
    </div>
  );
}

export function useExtensionMapProps(
  mode: string,
  waypoints: [number, number][],
  setWaypoints: (wp: [number, number][]) => void
) {
  if (mode === "idle") return {};
  return {
    editMode: true,
    waypoints,
    onWaypointsChange: setWaypoints,
  };
}
