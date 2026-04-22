/**
 * HrZones is the single source of truth for zone ceilings; defined in
 * shared/ so the client and server import the exact same type. This
 * module adds the server-only persistence helpers (JSON parse, DB
 * fallback, auto-derive).
 */
import type { HrZones } from "../../shared/types";
export type { HrZones };

// Default Z2 anchor (top of easy / aerobic threshold) when no explicit
// zones and no observation-based derivation is possible. 140 matches the
// client-side detectWorkout default so server-derived tags agree with
// the label string that was computed at upload time.
const FALLBACK_Z2_ANCHOR = 140;

const FRIEL_LTHR_SCALE = {
  z1_max: 0.85,
  z2_max: 0.89,
  z3_max: 0.94,
  z4_max: 0.99,
} as const;

const HRMAX_SCALE = {
  z1_max: 0.68,
  z2_max: 0.78,
  z3_max: 0.88,
  z4_max: 0.95,
} as const;

// Z2-anchor scaling mirrors the client's detectWorkout ratios so the two
// systems agree at the boundaries: easy ≤ Z2, steady ≤ Z2 × 1.08, tempo
// ≤ Z2 × 1.16, threshold ≤ Z2 × 1.25.
const Z2_SCALE = {
  z1_max: 1.00,
  z2_max: 1.08,
  z3_max: 1.16,
  z4_max: 1.25,
} as const;

export function parseZones(raw: string | null | undefined): HrZones | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (
      v && typeof v === "object" &&
      typeof v.z1_max === "number" &&
      typeof v.z2_max === "number" &&
      typeof v.z3_max === "number" &&
      typeof v.z4_max === "number"
    ) {
      return v as HrZones;
    }
  } catch {
    return null;
  }
  return null;
}

export function fallbackZones(): HrZones {
  return fromZ2Anchor(FALLBACK_Z2_ANCHOR);
}

export function fromZ2Anchor(anchor: number): HrZones {
  return {
    z1_max: Math.round(anchor * Z2_SCALE.z1_max),
    z2_max: Math.round(anchor * Z2_SCALE.z2_max),
    z3_max: Math.round(anchor * Z2_SCALE.z3_max),
    z4_max: Math.round(anchor * Z2_SCALE.z4_max),
  };
}

export function fromHrmax(hrmax: number): HrZones {
  return {
    z1_max: Math.round(hrmax * HRMAX_SCALE.z1_max),
    z2_max: Math.round(hrmax * HRMAX_SCALE.z2_max),
    z3_max: Math.round(hrmax * HRMAX_SCALE.z3_max),
    z4_max: Math.round(hrmax * HRMAX_SCALE.z4_max),
  };
}

export function fromLthr(lthr: number): HrZones {
  return {
    z1_max: Math.round(lthr * FRIEL_LTHR_SCALE.z1_max),
    z2_max: Math.round(lthr * FRIEL_LTHR_SCALE.z2_max),
    z3_max: Math.round(lthr * FRIEL_LTHR_SCALE.z3_max),
    z4_max: Math.round(lthr * FRIEL_LTHR_SCALE.z4_max),
  };
}

/**
 * Observation-based auto-derive. Prefers LTHR estimated from sustained
 * hard efforts; falls back to HRmax from the observed upper tail; falls
 * back to a fixed placeholder when there's almost no HR data.
 *
 * Inputs:
 *   - hrSamples: a flat array of per-record heart rates (nullable)
 *   - sustainedHardAvgHrs: avg HR of efforts sustained ≥20 min at or
 *     near the top of the user's effort distribution. Typically the avg
 *     HR of the user's fastest 30-60 min races/tempos.
 */
export function deriveZonesFromActivities(
  hrSamples: number[],
  sustainedHardAvgHrs: number[],
): HrZones {
  if (sustainedHardAvgHrs.length >= 1) {
    const lthr = median(sustainedHardAvgHrs);
    if (lthr >= 100 && lthr <= 220) return fromLthr(lthr);
  }
  if (hrSamples.length >= 1000) {
    const hrmax = percentile(hrSamples, 99);
    if (hrmax >= 120 && hrmax <= 230) return fromHrmax(hrmax);
  }
  return fallbackZones();
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}
