/**
 * Flexible metadata extracted from a parsed ParsedActivity JSON. Persisted
 * as a JSON blob in `activities.meta`, with the schema version persisted
 * alongside it as the indexed `meta_version` column. Bump META_VERSION when
 * deriveMeta's output shape changes — the backfill sweep will re-derive
 * every row whose stored meta_version is behind.
 */
import { elevationFromRecords } from "../../shared/elevation";

export const META_VERSION = 5;

export interface ActivityMeta {
  workoutLabel?: string;
  totalAscent?: number;
  totalDescent?: number;
}

export function deriveMeta(obj: unknown): ActivityMeta {
  const a = obj as {
    workoutLabel?: string;
    records?: Array<{ altitude?: number }>;
  };
  const meta: ActivityMeta = {};
  if (typeof a?.workoutLabel === "string") meta.workoutLabel = a.workoutLabel;
  const { ascent, descent } = elevationFromRecords(a?.records);
  if (ascent != null) meta.totalAscent = ascent;
  if (descent != null) meta.totalDescent = descent;
  return meta;
}

export function parseMeta(raw: string | null | undefined): ActivityMeta {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as ActivityMeta) : {};
  } catch {
    return {};
  }
}
