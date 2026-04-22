import type { HrZones } from "./zones";
import type { ActivitySummary, LapSummary, RecordPoint } from "../../shared/types";
import { detectWorkoutType } from "../../shared/detectWorkout";
import { detectRepStructure } from "../../shared/labeller";
import { detectHillSprints } from "../../shared/hillSprints";

/**
 * Multi-tag workout classification. One code path with the frontend —
 * primary intensity/structure tags come from the shared
 * `detectWorkoutType` (driving the label string the user already sees);
 * hilly/strides/hill-intervals/race layered on top.
 *
 *   intensity (≤1): easy | steady | tempo | race
 *   structure (≥0): intervals | progressive | strides | hill-intervals
 *   terrain   (≥0): hilly
 *
 * Thresholds are tuned so genuinely flat-but-noisy GPS data doesn't
 * tag hilly, and strides sessions don't also tag as intervals.
 */

export interface DeriveTagsInput {
  zones: HrZones;
  summary: ActivitySummary;
  /** Native FIT laps — drives intensity classification. */
  laps: LapSummary[];
  /** Effort-detected segments (falls back to laps). Drives structure. */
  segments: LapSummary[];
  records: RecordPoint[];
  totalDistance: number;
  totalAscent: number | null;
}

// Post-smoothing threshold. A genuinely hilly road run sits at 15-25 m/km;
// rolling terrain without sustained climbs typically under 10.
const HILLY_ASCENT_PER_KM = 15;
const HILLY_MIN_TOTAL_ASCENT_M = 100;

// Strides ≈ short fast bursts. Distance is the defining axis; duration
// follows. 300 m covers classic 100 m strides up through 200-300 m
// bursts that still finish in well under a minute at tempo pace.
const STRIDE_MAX_AVG_DIST_M = 300;

export function deriveTags(input: DeriveTagsInput): string[] {
  const tags = new Set<string>();

  // Primary tag comes from the exact same classifier the client runs
  // for its label string. z1_max doubles as the Z2 ceiling in the
  // zone-anchor scheme (easy ceiling = top of Z2), which is what the
  // client's detectWorkoutType expects.
  const primary = detectWorkoutType(input.summary, input.laps, input.zones.z1_max);
  if (primary && primary !== "unknown") tags.add(primary);

  // Structure refinements beyond what the single WorkoutType captures.
  const rep = detectRepStructure(input.segments, primary, input.records);
  if (rep) {
    const isStrides = rep.avgRepDistance < STRIDE_MAX_AVG_DIST_M;

    // strides and intervals are mutually exclusive — strides is the
    // specific subtype, not an extra modifier. If the client said
    // "intervals" we keep that; otherwise a strides-shaped rep on an
    // otherwise easy run becomes the strides tag.
    if (primary === "intervals") {
      if (isStrides) tags.add("strides");
    } else if (isStrides) {
      tags.add("strides");
      tags.delete("intervals");
    }

    if (rep.isHills) tags.add("hill-intervals");
  }

  // Sustained hill efforts that don't show up as structured laps (e.g.,
  // hill sprints logged without laps). Only fire when the structured-rep
  // detector found nothing, otherwise double-counts intervals/strides.
  if (!rep) {
    const sprints = detectHillSprints(input.records);
    if (sprints.length >= 3) tags.add("hill-intervals");
  }

  if (isHilly(input.totalDistance, input.totalAscent)) tags.add("hilly");

  if (tags.size === 0) tags.add("other");
  return [...tags];
}

function isHilly(totalDistance: number, totalAscent: number | null): boolean {
  if (totalAscent == null || totalDistance < 2000) return false;
  if (totalAscent < HILLY_MIN_TOTAL_ASCENT_M) return false;
  const km = totalDistance / 1000;
  return totalAscent / km >= HILLY_ASCENT_PER_KM;
}
