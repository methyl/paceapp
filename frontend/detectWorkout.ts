// Thin localStorage-backed wrapper over shared/detectWorkout. The pure
// logic lives in shared/ so the server's tag deriver runs the same code.

import type { ActivitySummary, LapSummary, WorkoutType } from "../shared/types";
import {
  DEFAULT_Z2_CEILING,
  detectWorkoutType as detectWorkoutTypeShared,
} from "../shared/detectWorkout";

export { DEFAULT_Z2_CEILING };

export function getZ2Ceiling(): number {
  try {
    const stored = localStorage.getItem("paceapp_z2_ceiling");
    if (stored) return Number(stored);
  } catch {
    return DEFAULT_Z2_CEILING;
  }
  return DEFAULT_Z2_CEILING;
}

export function setZ2Ceiling(value: number) {
  try {
    localStorage.setItem("paceapp_z2_ceiling", String(value));
  } catch {
    // Ignore storage errors — caller can't recover.
  }
}

export function detectWorkoutType(
  summary: ActivitySummary,
  laps: LapSummary[],
): WorkoutType {
  return detectWorkoutTypeShared(summary, laps, getZ2Ceiling());
}
