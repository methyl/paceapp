/**
 * User HR zones. Four boundaries define five zones:
 *   Z1 ≤ z1_max < Z2 ≤ z2_max < Z3 ≤ z3_max < Z4 ≤ z4_max < Z5.
 *
 * Tags rely on these zones to classify intensity (easy/steady/tempo/
 * threshold/vo2/anaerobic). The values are persisted as JSON in
 * `users.hr_zones`; a null column means "auto-derive from the user's
 * activities on read" (see deriveZonesFromActivities).
 */
export interface HrZones {
  z1_max: number;
  z2_max: number;
  z3_max: number;
  z4_max: number;
}

const FALLBACK_HRMAX = 190;

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
  return fromHrmax(FALLBACK_HRMAX);
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
