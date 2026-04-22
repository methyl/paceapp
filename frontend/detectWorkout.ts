// Thin wrapper over shared/detectWorkout. The pure classification lives
// in shared/ so the server's tag deriver runs the same code. This
// wrapper resolves the user's HR zones:
//   1. If window.__PACEAPP_ZONES is set (populated on load from
//      /api/user/settings), use it — that's the server-of-truth zones.
//   2. Otherwise fall back to a single-anchor default built from the
//      legacy localStorage Z2 ceiling, preserving current offline
//      behavior until every caller is wired to fetch zones explicitly.

import type { ActivitySummary, LapSummary, WorkoutType, HrZones } from "../shared/types";
import {
  DEFAULT_Z2_CEILING,
  defaultZonesFromAnchor,
  detectWorkoutType as detectWorkoutTypeShared,
} from "../shared/detectWorkout";

export { DEFAULT_Z2_CEILING };

declare global {
  interface Window {
    __PACEAPP_ZONES?: HrZones;
  }
}

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

export function setActiveZones(zones: HrZones | null) {
  if (typeof window !== "undefined") {
    window.__PACEAPP_ZONES = zones ?? undefined;
  }
}

export function getActiveZones(): HrZones {
  if (typeof window !== "undefined" && window.__PACEAPP_ZONES) {
    return window.__PACEAPP_ZONES;
  }
  return defaultZonesFromAnchor(getZ2Ceiling());
}

export function detectWorkoutType(
  summary: ActivitySummary,
  laps: LapSummary[],
): WorkoutType {
  return detectWorkoutTypeShared(summary, laps, getActiveZones());
}
