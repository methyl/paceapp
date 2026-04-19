import { useCallback, useEffect, useState } from "react";
import { api, type RemoteActivitySummary } from "./client";
import { loadFitBlob } from "../storage";
import { exportActivityToFit } from "../exportFit";
import type { ParsedActivity } from "../types";

export type ImportStatus = "idle" | "running" | "done" | "error";

export interface ImportProgress {
  status: ImportStatus;
  total: number;
  done: number;
  failed: number;
  currentFile?: string;
  error?: string;
}

/**
 * Sync helper: lists remote activities and imports all local IndexedDB
 * activities up to the server. Existing remote activities (matched by
 * fileName) are skipped unless `force` is true.
 */
export function useSync(enabled: boolean) {
  const [remote, setRemote] = useState<RemoteActivitySummary[] | null>(null);
  const [remoteError, setRemoteError] = useState("");
  const [progress, setProgress] = useState<ImportProgress>({
    status: "idle",
    total: 0,
    done: 0,
    failed: 0,
  });

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const { activities } = await api.listActivities();
      setRemote(activities);
      setRemoteError("");
    } catch (e) {
      setRemoteError(e instanceof Error ? e.message : "failed to load remote activities");
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) refresh();
    else setRemote(null);
  }, [enabled, refresh]);

  const importAll = useCallback(
    async (local: ParsedActivity[], opts: { force?: boolean } = {}) => {
      if (!enabled) return;
      const remoteByName = new Map<string, RemoteActivitySummary>();
      try {
        const { activities } = await api.listActivities();
        for (const a of activities) remoteByName.set(a.fileName, a);
        setRemote(activities);
      } catch (e) {
        setProgress({
          status: "error",
          total: 0,
          done: 0,
          failed: 0,
          error: e instanceof Error ? e.message : "failed to list remote",
        });
        return;
      }

      const toUpload = opts.force
        ? local
        : local.filter((a) => !remoteByName.has(a.fileName));

      setProgress({ status: "running", total: toUpload.length, done: 0, failed: 0 });

      let done = 0;
      let failed = 0;
      for (const activity of toUpload) {
        setProgress((p) => ({ ...p, currentFile: activity.fileName }));
        try {
          let fit = await loadFitBlob(activity.fileName);
          if (!fit) {
            // Pre-migration activity without stored raw bytes — re-encode from
            // parsed data. Not perfectly byte-equal to Garmin original but
            // playable by FIT tools.
            const bytes = exportActivityToFit(activity);
            fit = bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer;
          }
          await api.uploadActivity(activity.fileName, fit, JSON.stringify(activity));
          done++;
        } catch (e) {
          console.error("upload failed for", activity.fileName, e);
          failed++;
        }
        setProgress((p) => ({ ...p, done: done + failed }));
      }

      setProgress({
        status: "done",
        total: toUpload.length,
        done,
        failed,
      });
      refresh();
    },
    [enabled, refresh],
  );

  const downloadMissing = useCallback(
    async (
      localFileNames: Set<string>,
      onActivity: (activity: ParsedActivity) => void,
    ) => {
      if (!enabled) return;
      let list: RemoteActivitySummary[];
      try {
        const { activities } = await api.listActivities();
        list = activities;
        setRemote(activities);
      } catch (e) {
        setProgress({
          status: "error",
          total: 0,
          done: 0,
          failed: 0,
          error: e instanceof Error ? e.message : "failed to list remote",
        });
        return;
      }

      const missing = list.filter((r) => !localFileNames.has(r.fileName));
      setProgress({ status: "running", total: missing.length, done: 0, failed: 0 });

      let done = 0;
      let failed = 0;
      for (const r of missing) {
        setProgress((p) => ({ ...p, currentFile: r.fileName }));
        try {
          const parsed = await api.downloadActivityJson<ParsedActivity>(r.id);
          onActivity(parsed);
          done++;
        } catch (e) {
          console.error("download failed for", r.fileName, e);
          failed++;
        }
        setProgress((p) => ({ ...p, done: done + failed }));
      }

      setProgress({ status: "done", total: missing.length, done, failed });
    },
    [enabled],
  );

  return { remote, remoteError, progress, refresh, importAll, downloadMissing };
}
