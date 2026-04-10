export type WorkoutType =
  | "easy"
  | "steady"
  | "tempo"
  | "intervals"
  | "progressive"
  | "race"
  | "unknown";

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
}
