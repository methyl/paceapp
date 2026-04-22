// Shared runtime types used by both the frontend and the worker
// classification code. Anything frontend-only (UI colors, ParsedActivity
// shape) stays in frontend/types.ts.

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
