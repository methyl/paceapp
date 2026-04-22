// Re-export runtime types from shared/ so server and frontend stay in
// lock-step. UI-specific constants (colors, labels) + ParsedActivity
// (which references browser objects like File) live here.

export type { LapSummary, RecordPoint, ActivitySummary, WorkoutType } from "../shared/types";
import type { LapSummary, RecordPoint, ActivitySummary, WorkoutType } from "../shared/types";

export const WORKOUT_LABELS: Record<WorkoutType, string> = {
  easy: "Easy",
  steady: "Steady",
  tempo: "Tempo",
  intervals: "Intervals",
  progressive: "Progressive",
  race: "Race",
  unknown: "Other",
};

export const WORKOUT_COLORS: Record<WorkoutType, string> = {
  easy: "#22c55e",
  steady: "#3b82f6",
  tempo: "#f59e0b",
  intervals: "#ef4444",
  progressive: "#8b5cf6",
  race: "#ec4899",
  unknown: "#6b7280",
};

export interface ParsedActivity {
  id: string;
  fileName: string;
  workoutType: WorkoutType;
  /** Smart training notation, e.g. "2km easy + 4×1km @3:50 + 2km easy" */
  workoutLabel: string;
  summary: ActivitySummary;
  laps: LapSummary[];
  /** Effort-based segments: detected from pace changes if auto-lap, otherwise same as laps */
  segments: LapSummary[];
  /** Whether segments were auto-detected from record data */
  segmentsDetected: boolean;
  records: RecordPoint[];
  /** Number of original records before extension. Records beyond this are synthetic. */
  originalRecordCount?: number;
  /**
   * Number of original laps preserved unchanged at the head of `laps`.
   * If the original run's trailing lap was a partial auto-lap that got
   * absorbed into the extension, that lap is NOT counted here — the first
   * extension lap at index `originalLapCount` is the merged replacement,
   * and the partial is saved in `replacedPartialLap` for undo.
   */
  originalLapCount?: number;
  /**
   * Snapshot of the original partial trailing lap that was absorbed by the
   * extension (if any). Set only when an auto-lap-paced run ended mid-lap
   * and the extension completed that lap. Used to restore the original lap
   * table on undo.
   */
  replacedPartialLap?: LapSummary;
  /** Whether this activity has been extended with synthetic data */
  extended?: boolean;
  /** Raw decoded FIT messages for faithful re-export */
  rawFitMessages?: Record<string, unknown[]>;
  /**
   * Server-derived tags covering intensity, structure, terrain, and
   * context. Populated client-side by joining remote activity data via
   * fileName; absent when offline or for a not-yet-synced activity.
   */
  tags?: string[];
}
