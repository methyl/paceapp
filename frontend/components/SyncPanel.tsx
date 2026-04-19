import type { ImportProgress } from "../api/useSync";
import type { RemoteActivitySummary } from "../api/client";

interface Props {
  loggedIn: boolean;
  localCount: number;
  remote: RemoteActivitySummary[] | null;
  progress: ImportProgress;
  error: string;
  onImportAll: () => void;
  onImportAllForce: () => void;
  onDownloadMissing: () => void;
  missingRemoteCount: number;
}

export default function SyncPanel({
  loggedIn,
  localCount,
  remote,
  progress,
  error,
  onImportAll,
  onImportAllForce,
  onDownloadMissing,
  missingRemoteCount,
}: Props) {
  if (!loggedIn) return null;

  const remoteCount = remote?.length ?? 0;
  const running = progress.status === "running";
  const newLocal = Math.max(0, localCount - remoteCount);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between text-sm">
      <div className="flex items-center gap-3">
        <span className="font-medium text-gray-900">Cloud sync</span>
        <span className="text-gray-500">
          {localCount} local · {remoteCount} remote
        </span>
        {running && progress.currentFile && (
          <span className="text-blue-600 text-xs truncate max-w-xs">
            {progress.currentFile}… ({progress.done}/{progress.total})
          </span>
        )}
        {progress.status === "done" && (
          <span className="text-green-700 text-xs">
            processed {progress.done} of {progress.total}
            {progress.failed > 0 ? ` (${progress.failed} failed)` : ""}
          </span>
        )}
        {error && <span className="text-red-600 text-xs">{error}</span>}
        {progress.status === "error" && progress.error && (
          <span className="text-red-600 text-xs">{progress.error}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {missingRemoteCount > 0 && (
          <button
            onClick={onDownloadMissing}
            disabled={running}
            className="px-3 py-1.5 rounded bg-emerald-600 text-white font-medium text-xs disabled:opacity-50"
          >
            {running ? "Working…" : `Download ${missingRemoteCount}`}
          </button>
        )}
        <button
          onClick={onImportAll}
          disabled={running || localCount === 0}
          className="px-3 py-1.5 rounded bg-blue-600 text-white font-medium text-xs disabled:opacity-50"
        >
          {running ? "Importing…" : `Upload ${newLocal} new`}
        </button>
        <button
          onClick={onImportAllForce}
          disabled={running || localCount === 0}
          className="px-2 py-1.5 rounded border border-gray-300 text-gray-700 text-xs disabled:opacity-50"
          title="Re-upload every local activity, overwriting remote copies"
        >
          Re-upload all
        </button>
      </div>
    </div>
  );
}
