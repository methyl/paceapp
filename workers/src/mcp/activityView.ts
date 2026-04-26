/**
 * Pure transformation that turns a stored ParsedActivity JSON into the
 * MCP `get_activity` payload. Extracted from tools.ts so the
 * MCP↔UI reconciliation test in /test can exercise it directly without
 * spinning up a DB/R2 stub.
 *
 * Re-derives every speed/pace and the segment breakdown from records on
 * the way out so a frontend that always re-runs `parseFitFile` and a MCP
 * call that reads the persisted JSON return the same numbers.
 */

import type { LapSummary, RecordPoint, ActivitySummary } from "../../../shared/types";
import { computeKmSplits } from "../../../shared/splits";
import { normalizeLapsPace, normalizeSummaryPace } from "../../../shared/lapStats";
import { getEffortSegments } from "../../../shared/segmenter";

export type ActivityPart = "summary" | "laps" | "segments" | "splits" | "records";

export const DEFAULT_PARTS: ActivityPart[] = ["summary", "laps", "segments", "splits"];

export interface ActivityViewMeta {
  id: string;
  file_name: string;
  workout_type: string | null;
  workout_label: string | null;
  total_ascent_m: number | null;
  total_descent_m: number | null;
  tags: string[];
}

export interface ActivityViewBody {
  summary?: ActivitySummary;
  laps?: LapSummary[];
  segments?: LapSummary[];
  splits?: LapSummary[];
  records?: RecordPoint[];
}

export type ActivityView = ActivityViewMeta & ActivityViewBody;

export function buildActivityView(
  full: Record<string, unknown>,
  meta: ActivityViewMeta,
  parts: Iterable<ActivityPart> = DEFAULT_PARTS,
): ActivityView {
  const records = Array.isArray(full.records) ? (full.records as RecordPoint[]) : [];
  const storedLaps = Array.isArray(full.laps) ? (full.laps as LapSummary[]) : [];
  const laps = normalizeLapsPace(storedLaps);
  const wanted = new Set(parts);

  const out: ActivityView = { ...meta };

  if (wanted.has("summary") && full.summary && typeof full.summary === "object") {
    out.summary = normalizeSummaryPace(full.summary as ActivitySummary);
  }
  if (wanted.has("laps")) {
    out.laps = laps;
  }
  if (wanted.has("segments")) {
    if (laps.length > 0 && records.length > 0) {
      out.segments = getEffortSegments(laps, records);
    } else if (Array.isArray(full.segments)) {
      out.segments = normalizeLapsPace(full.segments as LapSummary[]);
    } else {
      out.segments = [];
    }
  }
  if (wanted.has("splits")) {
    out.splits = computeKmSplits(records);
  }
  if (wanted.has("records")) {
    out.records = records;
  }

  return out;
}
