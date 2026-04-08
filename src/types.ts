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
  summary: ActivitySummary;
  laps: LapSummary[];
  records: RecordPoint[];
}
