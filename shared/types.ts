// Shared runtime types used by both the frontend and the worker
// classification code. Anything frontend-only (UI colors, ParsedActivity
// shape) stays in frontend/types.ts.

/**
 * User-configurable HR zone ceilings. Four boundaries define five
 * zones: Z1 ≤ z1_max < Z2 ≤ z2_max < Z3 ≤ z3_max < Z4 ≤ z4_max < Z5.
 * The classifier uses z1/z2/z3_max directly as the easy/steady/tempo
 * ceilings — no derived multipliers.
 */
export interface HrZones {
  z1_max: number;
  z2_max: number;
  z3_max: number;
  z4_max: number;
}

export type WorkoutType =
  | "easy"
  | "steady"
  | "tempo"
  | "intervals"
  | "progressive"
  | "race"
  | "unknown";

export interface LapSummary {
  lapIndex: number;
  startTime: string;
  totalDistance: number;
  totalElapsedTime: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgCadence?: number;
  avgSpeed?: number;
  avgPace: string;
  avgVerticalOscillation?: number;
  avgGroundContactTime?: number;
  avgGroundContactTimeBalance?: number;
  avgStrideLength?: number;
  avgVerticalRatio?: number;
  avgPower?: number;
}

export interface RecordPoint {
  timestamp: string;
  elapsed: number;
  distance: number;
  altitude?: number;
  lat?: number;
  lng?: number;
  heartRate?: number;
  cadence?: number;
  speed?: number;
  verticalOscillation?: number;
  groundContactTime?: number;
  groundContactTimeBalance?: number;
  strideLength?: number;
  verticalRatio?: number;
  power?: number;
  lapIndex: number;
}

export interface ActivitySummary {
  sport?: string;
  startTime?: string;
  totalDistance: number;
  totalElapsedTime: number;
  avgHeartRate?: number;
  avgCadence?: number;
  avgSpeed?: number;
  avgPace: string;
  avgVerticalOscillation?: number;
  avgGroundContactTime?: number;
  avgStrideLength?: number;
  avgVerticalRatio?: number;
  avgPower?: number;
}
